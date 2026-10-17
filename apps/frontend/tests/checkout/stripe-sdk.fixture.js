// Deterministic UI fixture ONLY. It is never imported by production or counted as Stripe proof.
window.__stripeFixture = { confirms: 0, mounts: 0, unmounts: 0, clientSecrets: [], behavior: 'success' };
window.Stripe = function () {
  const fixture = window.__stripeFixture;
  return {
    _registerWrapper() {}, registerAppInfo() {}, createToken() {}, createPaymentMethod() {}, confirmCardPayment() {},
    elements(options) {
      fixture.clientSecrets.push(options.clientSecret);
      let frame;
      return {
        update() {}, on() {}, off() {},
        async submit() {
          const inputs = frame?.contentDocument?.querySelectorAll('input');
          return inputs?.length === 3 && [...inputs].every(input => input.value.trim()) ? {} : { error: { type: 'validation_error' } };
        },
        create() {
          const listeners = new Map(); let ready = false;
          return {
            on(name, callback) { listeners.set(name, callback); if (name === 'ready' && ready) queueMicrotask(callback); },
            off(name) { listeners.delete(name); }, update() {},
            mount(node) {
              fixture.mounts++; frame = document.createElement('iframe'); frame.title = 'Mock hosted card entry — intercepted UI test';
              frame.style.cssText = 'width:100%;border:0;display:block';
              frame.srcdoc = '<html lang="en"><body style="font:16px sans-serif"><p>INTERCEPTED UI TEST — not real Stripe</p><label>Mock card number<input aria-label="Mock card number" autocomplete="off"></label><br><label>Mock expiry<input aria-label="Mock expiry" autocomplete="off"></label><br><label>Mock security code<input aria-label="Mock security code" autocomplete="off"></label></body></html>';
              // Like the hosted SDK, size this test iframe to its own content rather than reserving empty space.
              frame.onload = () => {
                const body = frame.contentDocument.body;
                const bottomMargin = parseFloat(frame.contentWindow.getComputedStyle(body).marginBottom);
                frame.style.height = `${Math.ceil(body.getBoundingClientRect().bottom + bottomMargin)}px`;
                // Opt-in: emulate a slow hosted load (null = never ready). Default stays immediate.
                const fire = () => {
                  if (fixture.loadError) { listeners.get('loaderror')?.({ elementType: 'payment', error: { type: 'invalid_request_error' } }); return; }
                  ready = true; listeners.get('ready')?.();
                };
                const delay = fixture.readyDelayMs;
                if (delay === undefined) fire(); else if (delay !== null) setTimeout(fire, delay);
              }; node.appendChild(frame);
            },
            destroy() { fixture.unmounts++; frame?.remove(); },
          };
        },
      };
    },
    async confirmPayment() {
      fixture.confirms++;
      return fixture.behavior === 'decline' ? { error: { type: 'card_error' } } : fixture.behavior === 'unknown'
        ? { error: { type: 'api_connection_error' } } : { paymentIntent: { status: 'requires_capture' } };
    },
  };
};
