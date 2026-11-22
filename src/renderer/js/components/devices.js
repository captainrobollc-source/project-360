// Bluetooth "Add a device" flow, pairing PIN prompts, and joining Wi-Fi networks.
import { h } from '../util.js';
import { iconEl, orb } from '../icons.js';
import * as sound from '../sound.js';
import { modal, confirm, osk, button } from './modal.js';

export const KIND_ICON = { controller: 'controller', audio: 'headset', keyboard: 'keyboard', mouse: 'mouse', phone: 'speaker', computer: 'desktop', remote: 'tv', other: 'bluetooth' };
export const KIND_LABEL = { controller: 'Controller', audio: 'Audio', keyboard: 'Keyboard', mouse: 'Mouse', phone: 'Phone', computer: 'Computer', remote: 'Remote', other: 'Bluetooth device' };

const signal = (rssi) => (rssi == null ? '' : rssi > -60 ? '▂▄▆█' : rssi > -72 ? '▂▄▆' : rssi > -85 ? '▂▄' : '▂');
export const bars = (n) => ['', '▂', '▂▄', '▂▄▆', '▂▄▆█', '▂▄▆█'][Math.max(0, Math.min(5, n | 0))];

// ---- pairing ceremonies the helper hands to us (PIN shown / PIN typed / PIN compare)
let pinPrompt = null;
let listening = false;
export function listenForPairing() {
  if (listening) return;
  listening = true;
  window.p360.on('radio:event', async (ev) => {
    if (ev.type !== 'bt.pairing') return;
    const name = ev.name || 'the device';
    if (ev.kind === 'confirmPin') {
      let answered = false;
      const answer = (ok) => { if (answered) return; answered = true; window.p360.bt.reply(ev.id, ok, '').catch(() => {}); };
      pinPrompt = modal({
        build(panel, close) {
          panel.append(h('h3', {}, `Pair with ${name}?`), h('p', {}, `Check that ${name} shows this PIN:`), h('div.bigpin', {}, ev.pin),
            h('div.btns', {}, button('It matches', { onActivate: () => { answer(true); close(true); } }), button('Cancel', { onActivate: () => { answer(false); close(false); } })));
        },
        onClose: () => { answer(false); pinPrompt = null; },
      });
    } else if (ev.kind === 'providePin') {
      const ask = osk({ title: `PIN for ${name}`, placeholder: 'Often 0000 or 1234', maxLength: 16 });
      pinPrompt = ask; // closed (as cancelled) if pairing ends first
      const pin = await ask;
      if (pinPrompt === ask) pinPrompt = null;
      window.p360.bt.reply(ev.id, pin !== null && pin !== '', pin || '').catch(() => {});
    } else if (ev.kind === 'displayPin') {
      window.p360.bt.reply(ev.id, true, '').catch(() => {});
      pinPrompt = modal({
        build(panel, close) {
          panel.append(h('h3', {}, `Type this PIN on ${name}`), h('div.bigpin', {}, ev.pin), h('p', {}, 'Then press Enter on the device.'),
            h('div.btns', {}, button('Cancel', { onActivate: () => close('cancel') })));
        },
        onClose: (v) => { pinPrompt = null; if (v === 'cancel' || v === null) window.p360.bt.scan(false).catch(() => {}); },
      });
    } else {
      window.p360.bt.reply(ev.id, true, '').catch(() => {});
    }
  });
}

// ---- Add a device: live scan list; A pairs. Resolves true when something was paired.
export function addDevice({ toast }) {
  listenForPairing();
  return new Promise((resolve) => {
    let paired = false;
    let unsub = () => {};
    const items = new Map();
    let pairing = false;
    let closed = false; // the dialog was closed (B) while something was still in flight

    modal({
      panelClass: 'dialog btadd',
      sound: 'guide',
      prompts: () => [{ btn: 'a', label: 'Pair' }, { btn: 'b', label: 'Close' }],
      onClose: () => { closed = true; unsub(); window.p360.bt.scan(false).catch(() => {}); resolve(paired); },
      build(panel, close, focus) {
        const status = h('div.btstatus', {}, h('div.spin', {}, orb()), h('span', {}, 'Searching for devices…'));
        const list = h('div.btlist', { 'data-scroll': '' });
        const empty = h('div.empty-note', {}, 'Nothing found yet. Make sure the device is in pairing mode and close by.');
        const searchBtn = button('Search again', { icon: 'restart', onActivate: () => start() });
        panel.append(
          h('h3', {}, 'Add a device'),
          h('p', {}, 'Put your device in pairing mode.\nXbox controller: hold the pair button on top until the Xbox button flashes fast. Headphones: usually hold the power or Bluetooth button.'),
          status, list, empty,
          h('div.btns', {}, searchBtn));

        const setStatus = (text, spinning = true) => { status.lastChild.textContent = text; status.classList.toggle('idle', !spinning); };
        const start = () => {
          setStatus('Searching for devices…');
          window.p360.bt.scan(true).catch((e) => setStatus(e.message, false));
        };

        const upsert = (dev) => {
          let el = items.get(dev.id);
          const label = h('span', {}, dev.name);
          const right = h('span.val', {}, signal(dev.rssi));
          if (!el) {
            el = h('div.pill-btn.btdev', { 'data-focus': '' }, iconEl(KIND_ICON[dev.kind] || 'bluetooth'), label, right);
            el._rssi = dev.rssi ?? -100;
            el._activate = () => pair(dev, el);
            const after = [...list.children].find((c) => (c._rssi ?? -100) < el._rssi);
            list.insertBefore(el, after || null);
            items.set(dev.id, el);
            empty.style.display = 'none';
            // The first device found takes focus from "Search again"; after that, leave it alone.
            if (!focus.current || !panel.contains(focus.current) || (items.size === 1 && focus.current === searchBtn)) focus.set(el);
            sound.play('tick');
          } else if (!el._busy) {
            el.children[1].textContent = dev.name;
            el.children[2].textContent = signal(dev.rssi);
          }
        };

        const pair = async (dev, el) => {
          if (pairing) return;
          pairing = true;
          el._busy = true;
          el.children[2].textContent = 'Pairing…';
          setStatus(`Pairing with ${dev.name}…`);
          let res = null, err = null;
          try { res = await window.p360.bt.pair(dev.id); } catch (e) { err = e; }
          if (pinPrompt) { pinPrompt.close(null); pinPrompt = null; }
          pairing = false;
          el._busy = false;
          if (res && res.paired) {
            paired = true;
            toast({ title: `${dev.name} paired`, text: KIND_LABEL[dev.kind] || 'Bluetooth', sound: 'select' });
            close(true);
          } else {
            const why = err ? err.message : ({ AuthenticationTimeout: 'it timed out', AuthenticationFailure: 'the PIN was rejected', RejectedByHandler: 'it was cancelled', ConnectionRejected: 'the device refused', NotReadyToPair: 'it isn’t in pairing mode', RequiredHandlerNotRegistered: 'it needs a pairing method we can’t show' }[res && res.status] || (res && res.status) || 'unknown error');
            el.children[2].textContent = 'Failed';
            toast({ title: `Couldn’t pair ${dev.name}`, text: why, sound: 'error' });
            if (!closed) start();
          }
        };

        unsub = window.p360.on('radio:event', (ev) => {
          if (ev.type === 'bt.found') upsert(ev.dev);
          else if (ev.type === 'bt.gone') {
            const el = items.get(ev.id);
            if (el && !el._busy && focus.current !== el) { el.remove(); items.delete(ev.id); }
          } else if (ev.type === 'bt.scanDone' && !pairing) setStatus(items.size ? 'Pick a device to pair' : 'No devices found', false);
        });
        start();
      },
    });
  });
}

// ---- Join a Wi-Fi network. Resolves the helper's result, or null if cancelled.
export async function joinWifi(net, { toast, forcePassword = false } = {}) {
  let password = '';
  if (net.secure && (!net.saved || forcePassword)) {
    password = await osk({ title: `Password for ${net.ssid}`, placeholder: 'Network password', maxLength: 63 });
    if (password === null) return null;
  }
  toast({ title: `Connecting to ${net.ssid}…`, sound: 'tick' });
  let res;
  try { res = await window.p360.wifi.connect(net.ssid, password, true); } catch (e) { res = { ok: false, status: e.message }; }
  if (res.ok) { toast({ title: `Connected to ${net.ssid}`, sound: 'select' }); return res; }
  if (net.secure && res.status === 'InvalidCredential') {
    toast({ title: 'Wrong password', text: net.ssid, sound: 'error' });
    return joinWifi({ ...net, saved: false }, { toast, forcePassword: true });
  }
  const why = { NetworkNotAvailable: 'The network is out of range.', Timeout: 'It took too long.', AccessRevoked: 'Access was blocked.', UnsupportedAuthenticationProtocol: 'This network’s security type isn’t supported.' }[res.status] || res.status || '';
  toast({ title: `Couldn’t connect to ${net.ssid}`, text: why, sound: 'error' });
  return res;
}
