export function shopMapHtml() {
  const config = JSON.stringify({
    key: process.env.SDS_PUBLIC_AMAP_KEY ?? '',
    securityCode: process.env.SDS_PUBLIC_AMAP_SECURITY_CODE ?? '',
    serviceHost: process.env.SDS_PUBLIC_AMAP_SERVICE_HOST ?? ''
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>附近门店地图</title>
<style>
html,body,#map{margin:0;width:100%;height:100%;background:#f7f6f1;font-family:system-ui}
#message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;font-size:18px;color:#55655a;text-align:center;pointer-events:none}
.shop{max-width:210px;padding:12px 14px;background:white;border:2px solid #4c9a6a;border-radius:24px;color:#2f6b47;font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px #0002}
.shop.selected{background:#2f6b47;color:white}.shop.closed{border-color:#8a9690;color:#55655a}
.location{width:16px;height:16px;border:3px solid white;border-radius:50%;background:#4a7fb5;box-shadow:0 0 0 8px #4a7fb533}
#zoom{position:absolute;right:12px;bottom:34px;display:grid;gap:6px}
button{width:48px;height:48px;border:1px solid #e3e7df;border-radius:12px;background:white;font-size:26px;color:#2f6b47}
</style></head><body><div id="map"></div><div id="message">正在打开地图…</div>
<div id="zoom"><button id="plus" aria-label="放大地图">+</button><button id="minus" aria-label="缩小地图">−</button></div>
<script>
(function(){
  const config = ${config};
  const message = document.getElementById('message');
  const send = data => window.ReactNativeWebView?.postMessage(JSON.stringify(data));
  let map, markers = [], extent = '', timer;
  function fail() {
    clearTimeout(timer);
    message.textContent = '地图暂时打不开，可以切到列表继续找店';
    send({type:'error'});
  }
  if (!config.key) { fail(); return; }
  if (config.serviceHost) window._AMapSecurityConfig = {serviceHost:config.serviceHost};
  else if (config.securityCode) window._AMapSecurityConfig = {securityJsCode:config.securityCode};
  window.renderShops = function(data) {
    if (!map) return;
    map.remove(markers);
    markers = [];
    data.shops.forEach(shop => {
      const label = document.createElement('div');
      label.className = 'shop' + (shop.id === data.selectedId ? ' selected' : '') + (shop.status === 'closed' ? ' closed' : '');
      label.textContent = shop.name;
      const marker = new AMap.Marker({position:[shop.longitude,shop.latitude],content:label,anchor:'bottom-center',title:shop.name,zIndex:shop.id===data.selectedId?200:100});
      marker.on('click', () => send({type:'select',id:shop.id}));
      markers.push(marker);
    });
    if (data.location) {
      const point = document.createElement('div');
      point.className = 'location';
      markers.push(new AMap.Marker({position:[data.location.longitude,data.location.latitude],content:point,anchor:'center',title:'我的位置'}));
    }
    map.add(markers);
    const nextExtent = JSON.stringify([data.shops.map(shop => [shop.id,shop.longitude,shop.latitude]),data.location]);
    if (markers.length && nextExtent !== extent) map.setFitView(markers,true,[64,120,64,120],16);
    extent = nextExtent;
  };
  timer = setTimeout(fail, 15000);
  const script = document.createElement('script');
  script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(config.key);
  script.onerror = fail;
  script.onload = function() {
    try {
      if (!window.AMap) { fail(); return; }
      map = new AMap.Map('map',{zoom:14,viewMode:'2D',resizeEnable:true});
      map.on('complete', () => {clearTimeout(timer); message.textContent = '';});
      document.getElementById('plus').onclick = () => map.zoomIn();
      document.getElementById('minus').onclick = () => map.zoomOut();
      send({type:'ready'});
    } catch { fail(); }
  };
  document.head.appendChild(script);
})();
</script></body></html>`;
}
