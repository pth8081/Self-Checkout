import { html, render, Header, Icon, QR, Toasts, fmt, Scanner } from '/shared/lib.js';
render(html`<div><${Header} onMenu=${() => {}}/><div class="page"><div class="card"><h2>Thử thư viện</h2><${Icon} name="scan"/><${QR} text="GH-Q7-0001"/><p>${fmt.money(182000)} · ${fmt.pct(0.0275)}</p></div></div><${Toasts}/></div>`, document.getElementById('app'));
