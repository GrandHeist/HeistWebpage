// Early-access form. Without this file the form still works as a normal POST;
// with it, the request is sent in the background and the answer shows inline.
(function () {
  'use strict';

  var form = document.getElementById('signup-form');
  var status = document.getElementById('form-status');
  if (!form || !status || !window.fetch || !window.FormData) return;

  var box = form.closest('.signup');
  var button = form.querySelector('button[type="submit"]');
  var idleLabel = button.textContent;
  var sending = false;

  // Which field to point at for each error the server can report.
  var FIELD_FOR_ERROR = {
    invalid_email: 'email',
    invalid_role: 'role',
    invalid_server: 'server',
    server_too_long: 'server',
  };
  var FALLBACK = {
    400: 'Please check the form and try again.',
    413: 'That request was too large.',
    429: 'Too many attempts from your network. Please try again later.',
    503: 'Sign-ups are not being accepted right now. Please try again later.',
  };

  function clearInvalid() {
    Array.prototype.forEach.call(form.elements, function (el) {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
  }

  function showError(message, fieldId) {
    status.className = 'signup__status signup__status--error';
    status.textContent = message;
    clearInvalid();
    var field = fieldId && document.getElementById(fieldId);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', status.id);
      field.focus();
    }
  }

  function showSuccess() {
    status.className = 'signup__status signup__status--ok';
    status.textContent = '';
    var title = document.createElement('strong');
    title.textContent = "You're on the list.";
    var text = document.createElement('p');
    text.textContent = "Thanks. We'll only use your email to tell you when Heist Engine is ready.";
    status.appendChild(title);
    status.appendChild(text);
    form.hidden = true;
    box.classList.add('is-done');
    status.focus();
  }

  function setSending(on) {
    sending = on;
    button.disabled = on;
    button.textContent = on ? 'Sending…' : idleLabel;
    form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  form.addEventListener('input', function (event) {
    if (event.target.getAttribute && event.target.getAttribute('aria-invalid')) {
      event.target.removeAttribute('aria-invalid');
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) return;

    // Read the values before anything is disabled.
    var payload = {};
    new FormData(form).forEach(function (value, key) {
      payload[key] = typeof value === 'string' ? value : '';
    });

    setSending(true);
    status.className = 'signup__status';
    status.textContent = '';
    clearInvalid();

    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;

    fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () { return null; })
          .then(function (data) {
            if (response.ok && data && data.ok) return showSuccess();
            var message = (data && data.message) || FALLBACK[response.status] || 'Something went wrong. Please try again.';
            showError(message, data && FIELD_FOR_ERROR[data.error]);
          });
      })
      .catch(function () {
        showError('Could not reach the server. Check your connection and try again.');
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        setSending(false);
      });
  });
})();
