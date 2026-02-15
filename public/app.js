/* ============================================================
   glide-mq Demo - Frontend Application
   ============================================================ */

(function () {
  'use strict';

  // ---- State ----
  const orders = new Map(); // orderId -> { id, product, quantity, email, paymentMethod, status }
  const jobIdToOrderId = new Map(); // jobId -> orderId (for SSE event matching)
  let eventCount = 0;
  let sseConnected = false;

  // ---- DOM refs ----
  const orderForm = document.getElementById('orderForm');
  const orderTableBody = document.getElementById('orderTableBody');
  const emptyRow = document.getElementById('emptyRow');
  const orderCount = document.getElementById('orderCount');
  const queueGrid = document.getElementById('queueGrid');
  const eventLog = document.getElementById('eventLog');
  const eventLogEmpty = document.getElementById('eventLogEmpty');
  const eventCounter = document.getElementById('eventCounter');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const dlqToggle = document.getElementById('dlqToggle');
  const dlqList = document.getElementById('dlqList');
  const dlqArrow = document.getElementById('dlqArrow');
  const dlqCount = document.getElementById('dlqCount');
  const dlqEmpty = document.getElementById('dlqEmpty');
  const headerDot = document.querySelector('.header__dot');
  const headerStatusText = document.querySelector('.header__status-text');

  // ---- Order Form ----
  orderForm.addEventListener('submit', function (e) {
    e.preventDefault();
    submitOrder();
  });

  async function submitOrder() {
    const product = document.getElementById('product').value.trim();
    const quantity = parseInt(document.getElementById('quantity').value, 10);
    const email = document.getElementById('email').value.trim();
    const paymentMethod = document.getElementById('paymentMethod').value;

    if (!product || !quantity || !email) return;

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn__text').textContent = 'Submitting...';

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, quantity, email, paymentMethod }),
      });

      if (!res.ok) {
        const err = await res.json().catch(function () { return { error: 'Request failed' }; });
        throw new Error(err.error || 'Failed to submit order');
      }

      const data = await res.json();
      const order = {
        id: data.orderId || data.id,
        product: product,
        quantity: quantity,
        email: email,
        paymentMethod: paymentMethod,
        status: 'pending',
        progress: 0,
      };

      orders.set(String(order.id), order);
      // Map all jobIds (parent + children) back to this orderId for SSE event matching
      if (data.jobId) jobIdToOrderId.set(String(data.jobId), String(order.id));
      if (data.children) {
        data.children.forEach(function(c) {
          if (c.jobId) jobIdToOrderId.set(String(c.jobId), String(order.id));
        });
      }
      renderOrderRow(order, true);
      orderForm.reset();
      document.getElementById('quantity').value = '1';
      showToast('Order #' + order.id + ' placed', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn__text').textContent = 'Place Order';
    }
  }

  // ---- Cancel Order ----
  async function cancelOrder(id) {
    try {
      const res = await fetch('/api/orders/' + id, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(function () { return { error: 'Cancel failed' }; });
        throw new Error(err.error || 'Failed to cancel order');
      }
      updateOrderStatus(String(id), 'failed');
      showToast('Order #' + id + ' cancelled', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Make cancelOrder available globally for onclick handlers
  window.cancelOrder = cancelOrder;

  // ---- Order Rendering ----
  function renderOrderRow(order, isNew) {
    emptyRow.style.display = 'none';
    const existing = document.getElementById('order-row-' + order.id);
    if (existing) {
      updateRowCells(existing, order);
      return;
    }

    var tr = document.createElement('tr');
    tr.id = 'order-row-' + order.id;
    if (isNew) tr.className = 'order-row--new';

    tr.innerHTML =
      '<td style="font-family:var(--font-mono);font-weight:600;color:var(--accent)">#' + escapeHtml(String(order.id)) + '</td>' +
      '<td>' + escapeHtml(order.product) + ' <span style="color:var(--text-muted)">&times;' + order.quantity + '</span></td>' +
      '<td><span class="status-badge status-badge--' + order.status + '">' + order.status + '</span></td>' +
      '<td><div class="progress-bar"><div class="progress-bar__fill" style="width:' + order.progress + '%"></div></div></td>' +
      '<td>' + (order.status === 'completed' || order.status === 'failed' ? '' :
        '<button class="btn btn--cancel" onclick="cancelOrder(\'' + escapeHtml(String(order.id)) + '\')">Cancel</button>') + '</td>';

    orderTableBody.prepend(tr);
    orderCount.textContent = orders.size;
  }

  function updateRowCells(tr, order) {
    var cells = tr.querySelectorAll('td');
    // Status
    cells[2].innerHTML = '<span class="status-badge status-badge--' + order.status + '">' + order.status + '</span>';
    // Progress
    var fillClass = 'progress-bar__fill';
    if (order.status === 'completed') fillClass += ' progress-bar__fill--done';
    if (order.status === 'failed') fillClass += ' progress-bar__fill--fail';
    cells[3].innerHTML = '<div class="progress-bar"><div class="' + fillClass + '" style="width:' + order.progress + '%"></div></div>';
    // Actions
    if (order.status === 'completed' || order.status === 'failed') {
      cells[4].innerHTML = '';
    }
  }

  function updateOrderStatus(id, status) {
    var order = orders.get(id);
    if (!order) return;
    order.status = status;

    // Map status to progress percentage
    var progressMap = {
      pending: 0,
      processing: 40,
      completed: 100,
      failed: 100,
    };
    order.progress = progressMap[status] !== undefined ? progressMap[status] : order.progress;

    var tr = document.getElementById('order-row-' + id);
    if (tr) updateRowCells(tr, order);
  }

  // ---- Queue Dashboard ----
  async function refreshDashboard() {
    try {
      var res = await fetch('/api/dashboard');
      if (!res.ok) return;
      var data = await res.json();

      var queues = ['payment', 'inventory', 'shipping', 'notification', 'analytics', 'dead-letter'];
      for (var i = 0; i < queues.length; i++) {
        var q = queues[i];
        var stats = data[q] || {};
        updateStat(q + '-waiting', stats.waiting || 0);
        updateStat(q + '-active', stats.active || 0);
        updateStat(q + '-completed', stats.completed || 0);
        updateStat(q + '-failed', stats.failed || 0);
      }
    } catch (e) {
      // silently ignore fetch errors
    }
  }

  function updateStat(elementId, newVal) {
    var el = document.getElementById(elementId);
    if (!el) return;
    var current = el.textContent;
    if (String(newVal) !== current) {
      el.textContent = newVal;
      el.classList.remove('stat__val--flash');
      // Force reflow to restart animation
      void el.offsetWidth;
      el.classList.add('stat__val--flash');
    }
  }

  // Refresh dashboard every 2 seconds
  setInterval(refreshDashboard, 2000);
  refreshDashboard();

  // ---- SSE Connection ----
  function connectSSE() {
    var evtSource = new EventSource('/api/events');

    evtSource.onopen = function () {
      sseConnected = true;
      headerDot.style.background = 'var(--status-green)';
      headerStatusText.textContent = 'CONNECTED';
      headerStatusText.style.color = 'var(--status-green)';
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
      sseConnected = false;
      headerDot.style.background = 'var(--status-red)';
      headerStatusText.textContent = 'DISCONNECTED';
      headerStatusText.style.color = 'var(--status-red)';
      // EventSource reconnects automatically
    };
  }

  function handleSSEEvent(data) {
    // Append to event log
    appendEventLog(data);

    // Update order status if applicable
    if (data.jobId || data.orderId) {
      var jobId = String(data.jobId || '');
      // Resolve jobId to orderId via our mapping
      var id = jobIdToOrderId.get(jobId) || String(data.orderId || jobId);
      var eventType = data.event || data.type || '';
      var queue = data.queue || '';

      // Only update order status for pipeline-level events (not individual sub-queues)
      if (queue === 'order-pipeline' || queue === '') {
        if (eventType === 'completed') {
          updateOrderStatus(id, 'completed');
        } else if (eventType === 'failed') {
          updateOrderStatus(id, 'failed');
        } else if (eventType === 'active' || eventType === 'added') {
          updateOrderStatus(id, 'processing');
        }
      } else if (queue.includes('payment')) {
        if (eventType === 'completed') {
          updateOrderStatus(id, 'processing'); // payment done, still processing
        } else if (eventType === 'failed') {
          updateOrderStatus(id, 'failed');
        } else if (eventType === 'retrying') {
          updateOrderStatus(id, 'processing');
        }
      }
    }

    // If event is about a specific queue stage completing, update progress
    if (data.queue && data.jobId) {
      var order = orders.get(String(data.orderId || data.jobId));
      if (order && order.status === 'processing') {
        var stageProgress = {
          payment: 25,
          inventory: 50,
          shipping: 75,
          notification: 90,
          analytics: 95,
        };
        var stageVal = stageProgress[data.queue];
        if (stageVal && data.event === 'completed' && stageVal > order.progress) {
          order.progress = stageVal;
          var tr = document.getElementById('order-row-' + order.id);
          if (tr) updateRowCells(tr, order);
        }
      }
    }
  }

  // ---- Event Log ----
  function appendEventLog(data) {
    if (eventLogEmpty) eventLogEmpty.style.display = 'none';

    eventCount++;
    eventCounter.textContent = eventCount + ' event' + (eventCount !== 1 ? 's' : '');

    var entry = document.createElement('div');
    entry.className = 'event-entry';

    var now = new Date();
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

    var eventType = data.event || data.type || 'unknown';
    var typeClass = 'event-entry__type event-entry__type--' + eventType;

    var queue = data.queue || '-';
    var jobId = data.jobId ? '#' + data.jobId : '';
    var detail = '';

    if (data.returnvalue !== undefined) {
      detail = String(data.returnvalue);
    } else if (data.error) {
      detail = String(data.error);
    } else if (data.data) {
      detail = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
    }

    entry.innerHTML =
      '<span class="event-entry__time">' + time + '</span>' +
      '<span class="event-entry__queue">' + escapeHtml(queue) + '</span>' +
      '<span class="' + typeClass + '">' + escapeHtml(eventType) + '</span>' +
      '<span class="event-entry__detail">' + escapeHtml(jobId + (detail ? ' ' + detail : '')) + '</span>';

    eventLog.appendChild(entry);

    // Auto-scroll to bottom
    eventLog.scrollTop = eventLog.scrollHeight;

    // Keep max 500 entries
    while (eventLog.children.length > 501) {
      eventLog.removeChild(eventLog.children[1]); // skip empty placeholder at [0] if hidden
    }
  }

  clearLogBtn.addEventListener('click', function () {
    // Remove all event entries
    var entries = eventLog.querySelectorAll('.event-entry');
    for (var i = 0; i < entries.length; i++) {
      entries[i].remove();
    }
    eventCount = 0;
    eventCounter.textContent = '0 events';
    if (eventLogEmpty) eventLogEmpty.style.display = '';
  });

  // ---- DLQ Section ----
  var dlqOpen = false;

  dlqToggle.addEventListener('click', function () {
    dlqOpen = !dlqOpen;
    dlqList.classList.toggle('dlq-list--open', dlqOpen);
    dlqArrow.classList.toggle('dlq-toggle__arrow--open', dlqOpen);
    if (dlqOpen) refreshDLQ();
  });

  async function refreshDLQ() {
    try {
      var res = await fetch('/api/dlq');
      if (!res.ok) return;
      var data = await res.json();
      var jobs = Array.isArray(data) ? data : (data.jobs || []);

      dlqCount.textContent = jobs.length;

      if (jobs.length === 0) {
        dlqEmpty.style.display = '';
        // Remove all dlq-items
        var items = dlqList.querySelectorAll('.dlq-item');
        for (var i = 0; i < items.length; i++) items[i].remove();
        return;
      }

      dlqEmpty.style.display = 'none';
      // Clear old items
      var oldItems = dlqList.querySelectorAll('.dlq-item');
      for (var j = 0; j < oldItems.length; j++) oldItems[j].remove();

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
        dlqList.appendChild(item);
      }
    } catch (e) {
      // ignore
    }
  }

  // Auto-refresh DLQ if open
  setInterval(function () {
    if (dlqOpen) refreshDLQ();
  }, 5000);

  // ---- Load existing orders on startup ----
  async function loadOrders() {
    try {
      var res = await fetch('/api/orders');
      if (!res.ok) return;
      var data = await res.json();
      var list = Array.isArray(data) ? data : (data.orders || []);

      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        var order = {
          id: o.id || o.orderId,
          product: o.product || 'Unknown',
          quantity: o.quantity || 1,
          email: o.email || '',
          paymentMethod: o.paymentMethod || '',
          status: o.status || 'pending',
          progress: 0,
        };

        var progressMap = { pending: 0, processing: 40, completed: 100, failed: 100 };
        order.progress = progressMap[order.status] !== undefined ? progressMap[order.status] : 0;

        orders.set(String(order.id), order);
        renderOrderRow(order, false);
      }
    } catch (e) {
      // Server may not be ready yet
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

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + (type || 'success');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  // ---- Init ----
  loadOrders();
  connectSSE();
})();
