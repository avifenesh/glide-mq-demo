/* ============================================================
   glide-mq Demo - E-Commerce Store Frontend
   ============================================================ */

(function () {
  'use strict';

  // ---- Product Catalog ----
  var PRODUCTS = [
    { id: 'keyboard', name: 'Mechanical Keyboard', price: 129, icon: '\u2328\uFE0F' },
    { id: 'mouse', name: 'Wireless Mouse', price: 59, icon: '\uD83D\uDDB1\uFE0F' },
    { id: 'hub', name: 'USB-C Hub', price: 45, icon: '\uD83D\uDD0C' },
    { id: 'stand', name: 'Monitor Stand', price: 89, icon: '\uD83D\uDDA5\uFE0F' },
    { id: 'webcam', name: 'Webcam HD', price: 79, icon: '\uD83D\uDCF7' },
    { id: 'lamp', name: 'Desk Lamp', price: 35, icon: '\uD83D\uDCA1' },
  ];

  // Pipeline stage definitions - the order matters
  var PIPELINE_STAGES = [
    { key: 'payment', label: 'Payment', icon: '\uD83D\uDCB3' },
    { key: 'inventory', label: 'Inventory', icon: '\uD83D\uDCE6' },
    { key: 'shipping', label: 'Shipping', icon: '\uD83D\uDE9A' },
    { key: 'notification', label: 'Notification', icon: '\uD83D\uDD14' },
    { key: 'analytics', label: 'Done', icon: '\u2705' },
  ];

  // Queue names that map to pipeline stages
  var QUEUE_NAMES = ['payment', 'inventory', 'shipping', 'notification', 'analytics', 'dead-letter', 'order-pipeline'];

  // ---- State ----
  var cart = []; // [{ product, qty }]
  var orders = new Map(); // orderId -> order object
  var jobIdToOrderId = new Map(); // jobId -> orderId
  var eventCount = 0;
  var controlOpen = false;

  // ---- DOM refs ----
  var productGrid = document.getElementById('productGrid');
  var cartItems = document.getElementById('cartItems');
  var cartEmpty = document.getElementById('cartEmpty');
  var cartCount = document.getElementById('cartCount');
  var cartTotal = document.getElementById('cartTotal');
  var buyNowBtn = document.getElementById('buyNowBtn');
  var clearCartBtn = document.getElementById('clearCartBtn');
  var orderTracker = document.getElementById('orderTracker');
  var trackerEmpty = document.getElementById('trackerEmpty');
  var orderCountBadge = document.getElementById('orderCountBadge');
  var controlToggle = document.getElementById('controlToggle');
  var controlBody = document.getElementById('controlBody');
  var controlArrow = document.getElementById('controlArrow');
  var stressTestBtn = document.getElementById('stressTestBtn');
  var clearAllBtn = document.getElementById('clearAllBtn');
  var queueMetrics = document.getElementById('queueMetrics');
  var eventLog = document.getElementById('eventLog');
  var eventLogEmpty = document.getElementById('eventLogEmpty');
  var eventCounter = document.getElementById('eventCounter');
  var clearLogBtn = document.getElementById('clearLogBtn');
  var dlqViewer = document.getElementById('dlqViewer');
  var dlqEmpty = document.getElementById('dlqEmpty');
  var dlqBadge = document.getElementById('dlqBadge');
  var headerDot = document.getElementById('headerDot');
  var headerStatusText = document.getElementById('headerStatusText');
  var toastContainer = document.getElementById('toastContainer');

  // ---- Initialize Product Grid ----
  function renderProducts() {
    productGrid.innerHTML = '';
    for (var i = 0; i < PRODUCTS.length; i++) {
      var p = PRODUCTS[i];
      var card = document.createElement('div');
      card.className = 'product-card';
      card.setAttribute('data-product-id', p.id);

      card.innerHTML =
        '<div class="product-card__icon">' + p.icon + '</div>' +
        '<div class="product-card__name">' + escapeHtml(p.name) + '</div>' +
        '<div class="product-card__price">$' + p.price + '</div>' +
        '<div class="product-card__controls">' +
          '<div class="qty-selector">' +
            '<button class="qty-btn qty-minus" type="button" data-id="' + p.id + '">-</button>' +
            '<input class="qty-val" type="number" value="1" min="1" max="5" data-id="' + p.id + '" readonly>' +
            '<button class="qty-btn qty-plus" type="button" data-id="' + p.id + '">+</button>' +
          '</div>' +
          '<button class="btn btn--add-cart" type="button" data-id="' + p.id + '">Add to Cart</button>' +
        '</div>';

      productGrid.appendChild(card);
    }

    // Event delegation for product grid
    productGrid.addEventListener('click', function (e) {
      var target = e.target;
      if (target.classList.contains('qty-minus')) {
        var input = productGrid.querySelector('.qty-val[data-id="' + target.dataset.id + '"]');
        var val = parseInt(input.value, 10);
        if (val > 1) input.value = val - 1;
      } else if (target.classList.contains('qty-plus')) {
        var input2 = productGrid.querySelector('.qty-val[data-id="' + target.dataset.id + '"]');
        var val2 = parseInt(input2.value, 10);
        if (val2 < 5) input2.value = val2 + 1;
      } else if (target.classList.contains('btn--add-cart')) {
        var pid = target.dataset.id;
        var qtyInput = productGrid.querySelector('.qty-val[data-id="' + pid + '"]');
        var qty = parseInt(qtyInput.value, 10) || 1;
        addToCart(pid, qty);
        qtyInput.value = '1';
      }
    });
  }

  // ---- Cart Logic ----
  function addToCart(productId, qty) {
    var product = PRODUCTS.find(function (p) { return p.id === productId; });
    if (!product) return;

    var existing = cart.find(function (item) { return item.product.id === productId; });
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, 5);
    } else {
      cart.push({ product: product, qty: qty });
    }

    renderCart();
    showToast(product.name + ' added to cart', 'success');
  }

  function removeFromCart(index) {
    cart.splice(index, 1);
    renderCart();
  }

  function clearCart() {
    cart = [];
    renderCart();
  }

  function renderCart() {
    if (cart.length === 0) {
      cartEmpty.style.display = '';
      cartItems.querySelectorAll('.cart-item').forEach(function (el) { el.remove(); });
      cartCount.textContent = '0';
      cartTotal.textContent = '$0.00';
      buyNowBtn.disabled = true;
      return;
    }

    cartEmpty.style.display = 'none';
    buyNowBtn.disabled = false;

    var totalQty = 0;
    var totalPrice = 0;

    // Rebuild cart items
    var oldItems = cartItems.querySelectorAll('.cart-item');
    oldItems.forEach(function (el) { el.remove(); });

    for (var i = 0; i < cart.length; i++) {
      var item = cart[i];
      totalQty += item.qty;
      totalPrice += item.product.price * item.qty;

      var div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML =
        '<span class="cart-item__icon">' + item.product.icon + '</span>' +
        '<div class="cart-item__info">' +
          '<div class="cart-item__name">' + escapeHtml(item.product.name) + '</div>' +
          '<div class="cart-item__meta">Qty: ' + item.qty + ' x $' + item.product.price + '</div>' +
        '</div>' +
        '<span class="cart-item__price">$' + (item.product.price * item.qty) + '</span>' +
        '<button class="cart-item__remove" data-index="' + i + '" type="button">&times;</button>';

      cartItems.appendChild(div);
    }

    cartCount.textContent = totalQty;
    cartTotal.textContent = '$' + totalPrice.toFixed(2);

    // Remove button event delegation
    cartItems.onclick = function (e) {
      if (e.target.classList.contains('cart-item__remove')) {
        removeFromCart(parseInt(e.target.dataset.index, 10));
      }
    };
  }

  clearCartBtn.addEventListener('click', clearCart);

  // ---- Buy Now ----
  buyNowBtn.addEventListener('click', function () {
    if (cart.length === 0) return;
    submitOrder();
  });

  async function submitOrder() {
    var email = document.getElementById('checkoutEmail').value.trim() || 'demo@example.com';
    var paymentMethod = document.getElementById('checkoutPayment').value;

    // Build product description from cart
    var productNames = cart.map(function (item) {
      return item.product.name + ' x' + item.qty;
    }).join(', ');

    var totalQty = cart.reduce(function (sum, item) { return sum + item.qty; }, 0);

    buyNowBtn.disabled = true;
    buyNowBtn.querySelector('.btn__text').textContent = 'Processing...';

    try {
      var res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: productNames,
          quantity: totalQty,
          email: email,
          paymentMethod: paymentMethod,
        }),
      });

      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Request failed' }; });
        throw new Error(err.error || 'Failed to submit order');
      }

      var data = await res.json();
      var orderId = String(data.orderId || data.id);

      // Create order tracking object
      var order = {
        id: orderId,
        product: productNames,
        quantity: totalQty,
        email: email,
        paymentMethod: paymentMethod,
        status: 'pending',
        createdAt: new Date(),
        stages: {},
        logs: [],
        retryCount: 0,
        childJobIds: {},
      };

      // Initialize all pipeline stage states
      for (var s = 0; s < PIPELINE_STAGES.length; s++) {
        order.stages[PIPELINE_STAGES[s].key] = 'idle';
      }

      // Map jobIds to this order
      if (data.jobId) {
        jobIdToOrderId.set(String(data.jobId), orderId);
        order.parentJobId = String(data.jobId);
      }
      if (data.children) {
        for (var c = 0; c < data.children.length; c++) {
          var child = data.children[c];
          if (child.jobId) {
            jobIdToOrderId.set(String(child.jobId), orderId);
            // Map child queue names to jobIds for tracking
            var queueName = child.queue || '';
            if (queueName.includes('payment')) order.childJobIds.payment = String(child.jobId);
            if (queueName.includes('inventory') || queueName.includes('reserve')) order.childJobIds.inventory = String(child.jobId);
          }
        }
      }

      orders.set(orderId, order);
      renderOrderCard(order);
      updateOrderCount();
      clearCart();
      showToast('Order ' + orderId.slice(0, 12) + '... placed', 'success');

    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      buyNowBtn.disabled = cart.length === 0;
      buyNowBtn.querySelector('.btn__text').textContent = 'Buy Now';
    }
  }

  // ---- Cancel Order ----
  async function cancelOrder(orderId) {
    try {
      var res = await fetch('/api/orders/' + encodeURIComponent(orderId), { method: 'DELETE' });
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: 'Cancel failed' }; });
        throw new Error(err.error || 'Failed to cancel order');
      }
      var order = orders.get(orderId);
      if (order) {
        order.status = 'failed';
        for (var key in order.stages) {
          if (order.stages[key] !== 'completed') {
            order.stages[key] = 'failed';
          }
        }
        updateOrderCardDOM(order);
      }
      showToast('Order cancelled', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  window.cancelOrder = cancelOrder;
  window.toggleOrderDetails = toggleOrderDetails;

  // ---- Order Card Rendering ----
  function renderOrderCard(order) {
    trackerEmpty.style.display = 'none';

    var card = document.createElement('div');
    card.className = 'order-card';
    card.id = 'order-card-' + order.id;

    card.innerHTML = buildOrderCardHTML(order);
    orderTracker.prepend(card);
  }

  function buildOrderCardHTML(order) {
    var statusClass = 'order-card__status--' + order.status;
    var canCancel = order.status !== 'completed' && order.status !== 'failed';

    var html =
      '<div class="order-card__header">' +
        '<div>' +
          '<span class="order-card__id">#' + escapeHtml(order.id.slice(0, 16)) + '</span>' +
          '<span class="order-card__product">' + escapeHtml(order.product) + '</span>' +
        '</div>' +
        '<div class="order-card__actions">' +
          '<span class="order-card__status ' + statusClass + '">' + order.status + '</span>' +
          (canCancel ? '<button class="btn btn--cancel" onclick="cancelOrder(\'' + escapeHtml(order.id) + '\')" type="button">Cancel</button>' : '') +
        '</div>' +
      '</div>';

    // Pipeline visualization
    html += '<div class="pipeline">';
    for (var i = 0; i < PIPELINE_STAGES.length; i++) {
      var stage = PIPELINE_STAGES[i];
      var stageState = order.stages[stage.key] || 'idle';
      var nodeClass = 'pipeline-node pipeline-node--' + stageState;

      html += '<div class="pipeline-stage">';
      html += '<div class="' + nodeClass + '" data-stage="' + stage.key + '">';
      html += '<span class="pipeline-node__icon">' + stage.icon + '</span>';
      html += '<span class="pipeline-node__label">' + stage.label + '</span>';
      html += '<span class="pipeline-node__retry" data-retry="' + stage.key + '">' + (order.retryCount || 0) + '</span>';
      html += '</div>';

      // Arrow between stages (not after the last one)
      if (i < PIPELINE_STAGES.length - 1) {
        var arrowClass = 'pipeline-arrow';
        if (stageState === 'completed') {
          arrowClass += ' pipeline-arrow--done';
        } else if (stageState === 'active' || stageState === 'retrying') {
          arrowClass += ' pipeline-arrow--active';
        }
        html += '<div class="' + arrowClass + '"></div>';
      }

      html += '</div>';
    }
    html += '</div>';

    // Details toggle
    html += '<button class="order-card__details-toggle" onclick="toggleOrderDetails(\'' + escapeHtml(order.id) + '\')" type="button">Details</button>';
    html += '<div class="order-card__details" id="order-details-' + order.id + '">';
    html += '<div class="order-details-content">';
    html += '<div class="order-detail-row"><span class="order-detail-label">Email</span><span>' + escapeHtml(order.email || '') + '</span></div>';
    html += '<div class="order-detail-row"><span class="order-detail-label">Payment</span><span>' + escapeHtml(order.paymentMethod || '') + '</span></div>';
    html += '<div class="order-detail-row"><span class="order-detail-label">Created</span><span>' + formatTime(order.createdAt) + '</span></div>';
    html += '<div class="order-detail-logs" id="order-logs-' + order.id + '">';
    if (order.logs.length === 0) {
      html += '<div class="order-log-entry">Waiting for events...</div>';
    } else {
      for (var l = 0; l < order.logs.length; l++) {
        html += '<div class="order-log-entry ' + (order.logs[l].cls || '') + '">' + escapeHtml(order.logs[l].text) + '</div>';
      }
    }
    html += '</div>';
    html += '</div></div>';

    return html;
  }

  function updateOrderCardDOM(order) {
    var card = document.getElementById('order-card-' + order.id);
    if (!card) return;

    // Update card border class
    card.className = 'order-card';
    if (order.status === 'completed') card.className += ' order-card--completed';
    if (order.status === 'failed') card.className += ' order-card--failed';

    card.innerHTML = buildOrderCardHTML(order);
  }

  function toggleOrderDetails(orderId) {
    var details = document.getElementById('order-details-' + orderId);
    if (details) {
      details.classList.toggle('order-card__details--open');
    }
  }

  function addOrderLog(orderId, text, cls) {
    var order = orders.get(orderId);
    if (!order) return;

    var timestamp = formatTimeShort(new Date());
    var logEntry = { text: timestamp + ' ' + text, cls: cls || '' };
    order.logs.push(logEntry);

    // Also update the DOM log container if it exists
    var logContainer = document.getElementById('order-logs-' + orderId);
    if (logContainer) {
      // Remove "waiting" placeholder
      if (order.logs.length === 1) {
        logContainer.innerHTML = '';
      }
      var div = document.createElement('div');
      div.className = 'order-log-entry ' + (cls || '');
      div.textContent = logEntry.text;
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }

  function updateOrderCount() {
    var count = orders.size;
    orderCountBadge.textContent = count + ' order' + (count !== 1 ? 's' : '');
  }

  // ---- SSE Connection ----
  function connectSSE() {
    var evtSource = new EventSource('/api/events');

    evtSource.onopen = function () {
      headerDot.className = 'header__dot header__dot--connected';
      headerStatusText.textContent = 'CONNECTED';
      headerStatusText.style.color = '';
    };

    evtSource.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        handleSSEEvent(data);
      } catch (err) {
        // ignore parse errors
      }
    };

    evtSource.onerror = function () {
      headerDot.className = 'header__dot header__dot--disconnected';
      headerStatusText.textContent = 'DISCONNECTED';
      headerStatusText.style.color = '';
    };
  }

  function handleSSEEvent(data) {
    // Append to event log
    appendEventLog(data);

    var eventType = data.type || data.event || '';
    var queue = data.queue || '';
    var jobId = String(data.jobId || '');

    // Skip non-actionable events
    if (eventType === 'connected' || !jobId) return;

    // Resolve jobId to orderId
    var orderId = jobIdToOrderId.get(jobId);
    if (!orderId) return;

    var order = orders.get(orderId);
    if (!order) return;

    // Determine which pipeline stage this event belongs to
    var stageKey = resolveStageKey(queue);
    if (!stageKey) return;

    // Update the stage state based on event type
    switch (eventType) {
      case 'added':
      case 'active':
        if (order.stages[stageKey] !== 'completed') {
          order.stages[stageKey] = 'active';
          order.status = 'processing';
          addOrderLog(orderId, stageKey + ' processing', '');
        }
        break;

      case 'completed':
        order.stages[stageKey] = 'completed';
        addOrderLog(orderId, stageKey + ' completed', 'order-log-entry--complete');

        // Check if all stages are complete
        if (allStagesCompleted(order)) {
          order.status = 'completed';
          showToast('Order ' + orderId.slice(0, 12) + '... completed', 'success');
        } else {
          order.status = 'processing';
        }

        // When order-pipeline completes, the fulfillment chain fires.
        // Map the new jobs that will be created by the pipeline worker.
        // We cannot know their jobIds in advance, so we rely on queue-level matching.
        if (queue === 'order-pipeline') {
          addOrderLog(orderId, 'Fulfillment chain triggered', 'order-log-entry--complete');
        }
        break;

      case 'failed':
        order.stages[stageKey] = 'failed';
        addOrderLog(orderId, stageKey + ' failed' + (data.failedReason ? ': ' + data.failedReason : ''), 'order-log-entry--fail');

        // Payment failures may retry - only mark order failed if no retries left
        if (stageKey === 'payment') {
          // Check if it will be retried (attemptsMade < max attempts)
          if (data.attemptsMade !== undefined && data.attemptsMade < 3) {
            order.stages[stageKey] = 'retrying';
            order.retryCount = (data.attemptsMade || 0) + 1;
            addOrderLog(orderId, 'Payment will retry (attempt ' + order.retryCount + '/3)', 'order-log-entry--retry');
          } else {
            order.status = 'failed';
            showToast('Order ' + orderId.slice(0, 12) + '... failed', 'error');
          }
        } else {
          order.status = 'failed';
          showToast('Order ' + orderId.slice(0, 12) + '... failed', 'error');
        }
        break;

      case 'retrying':
        order.stages[stageKey] = 'retrying';
        order.retryCount = (order.retryCount || 0) + 1;
        order.status = 'processing';
        addOrderLog(orderId, stageKey + ' retrying (attempt ' + order.retryCount + ')', 'order-log-entry--retry');
        break;

      case 'progress':
        addOrderLog(orderId, stageKey + ' progress: ' + JSON.stringify(data.data), '');
        break;
    }

    // Update the DOM
    updateOrderCardDOM(order);
  }

  function resolveStageKey(queueName) {
    if (!queueName) return null;
    if (queueName === 'order-pipeline') return null; // Parent flow - handle specially
    for (var i = 0; i < PIPELINE_STAGES.length; i++) {
      if (queueName === PIPELINE_STAGES[i].key || queueName.includes(PIPELINE_STAGES[i].key)) {
        return PIPELINE_STAGES[i].key;
      }
    }
    return null;
  }

  function allStagesCompleted(order) {
    for (var i = 0; i < PIPELINE_STAGES.length; i++) {
      if (order.stages[PIPELINE_STAGES[i].key] !== 'completed') {
        return false;
      }
    }
    return true;
  }

  // ---- Event Log ----
  function appendEventLog(data) {
    if (!eventLogEmpty) return;
    eventLogEmpty.style.display = 'none';

    eventCount++;
    eventCounter.textContent = eventCount + ' event' + (eventCount !== 1 ? 's' : '');

    var entry = document.createElement('div');
    entry.className = 'event-entry';

    var now = new Date();
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

    var eventType = data.type || data.event || 'unknown';
    var typeClass = 'event-entry__type event-entry__type--' + eventType;
    var queue = data.queue || '-';
    var jobId = data.jobId ? '#' + data.jobId : '';
    var detail = '';

    if (data.returnvalue !== undefined) {
      detail = String(data.returnvalue);
    } else if (data.failedReason) {
      detail = String(data.failedReason);
    } else if (data.error) {
      detail = String(data.error);
    }

    entry.innerHTML =
      '<span class="event-entry__time">' + time + '</span>' +
      '<span class="event-entry__queue">' + escapeHtml(queue) + '</span>' +
      '<span class="' + typeClass + '">' + escapeHtml(eventType) + '</span>' +
      '<span class="event-entry__detail">' + escapeHtml(jobId + (detail ? ' ' + detail : '')) + '</span>';

    eventLog.appendChild(entry);
    eventLog.scrollTop = eventLog.scrollHeight;

    // Limit entries
    while (eventLog.children.length > 501) {
      eventLog.removeChild(eventLog.children[1]);
    }
  }

  clearLogBtn.addEventListener('click', function () {
    var entries = eventLog.querySelectorAll('.event-entry');
    entries.forEach(function (el) { el.remove(); });
    eventCount = 0;
    eventCounter.textContent = '0 events';
    if (eventLogEmpty) eventLogEmpty.style.display = '';
  });

  // ---- Queue Dashboard Metrics ----
  function initQueueMetrics() {
    queueMetrics.innerHTML = '';
    for (var i = 0; i < QUEUE_NAMES.length; i++) {
      var qName = QUEUE_NAMES[i];
      var isDlq = qName === 'dead-letter';
      var metric = document.createElement('div');
      metric.className = 'queue-metric' + (isDlq ? ' queue-metric--dlq' : '');
      metric.innerHTML =
        '<div class="queue-metric__name">' + escapeHtml(qName) + '</div>' +
        '<div class="queue-metric__stats">' +
          '<div class="metric-stat"><span class="metric-stat__val" id="m-' + qName + '-w">0</span><span class="metric-stat__label">wait</span></div>' +
          '<div class="metric-stat"><span class="metric-stat__val" id="m-' + qName + '-a">0</span><span class="metric-stat__label">act</span></div>' +
          '<div class="metric-stat metric-stat--good"><span class="metric-stat__val" id="m-' + qName + '-c">0</span><span class="metric-stat__label">done</span></div>' +
          '<div class="metric-stat metric-stat--bad"><span class="metric-stat__val" id="m-' + qName + '-f">0</span><span class="metric-stat__label">fail</span></div>' +
        '</div>';
      queueMetrics.appendChild(metric);
    }
  }

  async function refreshDashboard() {
    try {
      var res = await fetch('/api/dashboard');
      if (!res.ok) return;
      var data = await res.json();

      for (var i = 0; i < QUEUE_NAMES.length; i++) {
        var q = QUEUE_NAMES[i];
        var stats = data[q] || {};
        updateMetricVal('m-' + q + '-w', stats.waiting || 0);
        updateMetricVal('m-' + q + '-a', stats.active || 0);
        updateMetricVal('m-' + q + '-c', stats.completed || 0);
        updateMetricVal('m-' + q + '-f', stats.failed || 0);
      }
    } catch (e) {
      // silently ignore
    }
  }

  function updateMetricVal(elementId, newVal) {
    var el = document.getElementById(elementId);
    if (!el) return;
    if (String(newVal) !== el.textContent) {
      el.textContent = newVal;
      el.classList.remove('metric-stat__val--flash');
      void el.offsetWidth;
      el.classList.add('metric-stat__val--flash');
    }
  }

  // ---- DLQ Viewer ----
  async function refreshDLQ() {
    try {
      var res = await fetch('/api/dashboard/dlq');
      if (!res.ok) return;
      var data = await res.json();
      var jobs = Array.isArray(data) ? data : (data.jobs || []);

      dlqBadge.textContent = jobs.length;

      if (jobs.length === 0) {
        dlqEmpty.style.display = '';
        dlqViewer.querySelectorAll('.dlq-item').forEach(function (el) { el.remove(); });
        return;
      }

      dlqEmpty.style.display = 'none';
      dlqViewer.querySelectorAll('.dlq-item').forEach(function (el) { el.remove(); });

      for (var k = 0; k < jobs.length; k++) {
        var job = jobs[k];
        var item = document.createElement('div');
        item.className = 'dlq-item';
        item.innerHTML =
          '<div class="dlq-item__header">' +
            '<span class="dlq-item__id">Job #' + escapeHtml(String(job.id || job.jobId || k)) + '</span>' +
            '<span class="dlq-item__queue">' + escapeHtml(job.queue || job.failedQueue || 'unknown') + '</span>' +
          '</div>' +
          '<div class="dlq-item__data">' + escapeHtml(JSON.stringify(job.data || job, null, 2)) + '</div>';
        dlqViewer.appendChild(item);
      }
    } catch (e) {
      // ignore
    }
  }

  // ---- Control Panel Toggle ----
  controlToggle.addEventListener('click', function () {
    controlOpen = !controlOpen;
    controlBody.classList.toggle('control-body--open', controlOpen);
    controlArrow.classList.toggle('control-toggle__arrow--open', controlOpen);
    if (controlOpen) {
      refreshDashboard();
      refreshDLQ();
    }
  });

  // ---- Stress Test ----
  stressTestBtn.addEventListener('click', async function () {
    stressTestBtn.disabled = true;
    stressTestBtn.textContent = 'Submitting...';

    var submitted = 0;
    var failed = 0;

    for (var i = 0; i < 10; i++) {
      try {
        var product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
        var qty = Math.floor(Math.random() * 3) + 1;
        var paymentMethods = ['credit', 'debit', 'crypto'];
        var pm = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];

        var res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product: product.name,
            quantity: qty,
            email: 'stress-test-' + i + '@example.com',
            paymentMethod: pm,
          }),
        });

        if (!res.ok) throw new Error('Failed');

        var data = await res.json();
        var orderId = String(data.orderId || data.id);

        var order = {
          id: orderId,
          product: product.name + ' x' + qty,
          quantity: qty,
          email: 'stress-test-' + i + '@example.com',
          paymentMethod: pm,
          status: 'pending',
          createdAt: new Date(),
          stages: {},
          logs: [],
          retryCount: 0,
          childJobIds: {},
        };

        for (var s = 0; s < PIPELINE_STAGES.length; s++) {
          order.stages[PIPELINE_STAGES[s].key] = 'idle';
        }

        if (data.jobId) {
          jobIdToOrderId.set(String(data.jobId), orderId);
          order.parentJobId = String(data.jobId);
        }
        if (data.children) {
          for (var c = 0; c < data.children.length; c++) {
            var child = data.children[c];
            if (child.jobId) {
              jobIdToOrderId.set(String(child.jobId), orderId);
            }
          }
        }

        orders.set(orderId, order);
        renderOrderCard(order);
        submitted++;
      } catch (e) {
        failed++;
      }
    }

    updateOrderCount();
    showToast('Stress test: ' + submitted + ' submitted, ' + failed + ' failed', submitted > 0 ? 'info' : 'error');

    stressTestBtn.disabled = false;
    stressTestBtn.textContent = 'Stress Test (10 orders)';
  });

  // ---- Clear All ----
  clearAllBtn.addEventListener('click', async function () {
    if (!confirm('Clear all queues? This will obliterate all jobs.')) return;

    clearAllBtn.disabled = true;
    clearAllBtn.textContent = 'Clearing...';

    try {
      // The demo server does not have an obliterate endpoint, so we just clear the UI
      orders.clear();
      jobIdToOrderId.clear();
      orderTracker.innerHTML = '';
      // Re-create the empty placeholder since innerHTML cleared it
      var newEmpty = document.createElement('p');
      newEmpty.className = 'tracker-empty';
      newEmpty.id = 'trackerEmpty';
      newEmpty.textContent = 'No orders yet. Add items to your cart and click Buy Now.';
      orderTracker.appendChild(newEmpty);
      trackerEmpty = newEmpty;
      updateOrderCount();
      showToast('UI cleared', 'info');
    } catch (e) {
      showToast('Clear failed: ' + e.message, 'error');
    } finally {
      clearAllBtn.disabled = false;
      clearAllBtn.textContent = 'Clear All Queues';
    }
  });

  // ---- Load Existing Orders ----
  async function loadOrders() {
    try {
      var res = await fetch('/api/orders');
      if (!res.ok) return;
      var data = await res.json();
      var list = Array.isArray(data) ? data : (data.orders || []);

      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        var orderId = String(o.orderId || o.id);
        if (orders.has(orderId)) continue;

        var order = {
          id: orderId,
          product: o.product || 'Order',
          quantity: o.quantity || 1,
          email: o.email || '',
          paymentMethod: o.paymentMethod || '',
          status: o.status || 'completed',
          createdAt: o.timestamp ? new Date(o.timestamp) : new Date(),
          stages: {},
          logs: [],
          retryCount: 0,
          childJobIds: {},
        };

        // For existing completed/failed orders, set all stages accordingly
        var stageState = order.status === 'completed' ? 'completed' : (order.status === 'failed' ? 'failed' : 'idle');
        for (var s = 0; s < PIPELINE_STAGES.length; s++) {
          order.stages[PIPELINE_STAGES[s].key] = stageState;
        }

        orders.set(orderId, order);
        renderOrderCard(order);
      }
      updateOrderCount();
    } catch (e) {
      // Server may not be ready
    }
  }

  // ---- Utilities ----
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatTime(date) {
    if (!date) return '-';
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function formatTimeShort(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + (type || 'success');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  // ---- Periodic Refreshes ----
  setInterval(refreshDashboard, 3000);
  setInterval(function () {
    if (controlOpen) refreshDLQ();
  }, 5000);

  // ---- Init ----
  renderProducts();
  initQueueMetrics();
  renderCart();
  loadOrders();
  connectSSE();
  refreshDashboard();
})();
