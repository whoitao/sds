/** 门店列表、门店地图与门店页文案（门店名、地址、公告等业务数据不入字典） */
const zh = {
  title: '附近的店',
  filterWithinRange: '3 公里内',
  filterOnlyOpen: '只看营业中',

  locateReadyPrefix: '按 ',
  locateReadyHighlight: '当前位置',
  locateReadySuffix: ' 附近找的店',
  locating: '正在获取位置…',
  locateDenied: '没拿到位置，先按门店列表看',
  locateUnsupported: '这个浏览器不支持定位，先按门店列表看',
  openLocation: '打开定位',
  relocate: '重新定位',

  emptyOnlyOpen: '现在没有营业中的门店，取消筛选看看全部',
  emptyOutOfRange: '3 公里内没有营业中的门店，取消「3 公里内」看看全部',
  emptyNone: '暂时还没有门店，晚点再来看看',

  opening: '正在打开门店…',
  statusOpen: '营业中',
  statusClosed: '休息中',
  notTakingToday: '今天不接单',
  currentShop: '当前门店',
  selectShop: '选他',
  goShopping: '去买菜',
  callShop: '打电话',
  straight: '直线 {distance}',
  footerNote: '距离是直线距离，仅供参考；实际能不能送，以店里接单为准。',
  shopsLoadFailed: '门店加载失败，请稍后刷新重试',

  mapLoading: '地图加载中…',
  mapFailed: '地图加载失败',
  mapErrorTitle: '地图暂时没打开',
  mapErrorNote: '{error}。门店列表照常可用，可以先从列表里选店。',
  mapAriaLabel: '附近门店地图',
  mapZoomIn: '放大地图',
  mapZoomOut: '缩小地图',
  mapBackToMe: '回到我的位置',
  mapMeLabel: '我在这',
  mapPinClosed: '{name} · 休息',

  notFoundTitle: '这家店现在进不去',
  notFoundNote: '门店不存在、还没开始接单，或者已经暂停营业。换一家近的看看吧。',
  backToShops: '回附近的店',
  menuLoadFailedTitle: '菜单加载失败',
  menuLoadFailedNote: '网络异常，请稍后刷新重试',
  productsLoadFailed: '菜品加载失败，请刷新重试',

  distanceMeters: '{value} 米',
  distanceKilometers: '{value} 公里',
  distanceUnknown: '距离未知',
  hoursUnknown: '营业时间未知'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  title: 'Nearby shops',
  filterWithinRange: 'Within 3 km',
  filterOnlyOpen: 'Open only',

  locateReadyPrefix: 'Shops near your ',
  locateReadyHighlight: 'current location',
  locateReadySuffix: '',
  locating: 'Getting your location…',
  locateDenied: 'Location unavailable. Showing the shop list for now.',
  locateUnsupported: 'This browser does not support location. Showing the shop list for now.',
  openLocation: 'Turn on location',
  relocate: 'Locate again',

  emptyOnlyOpen: 'No shops are open right now. Clear the filter to see all shops.',
  emptyOutOfRange: 'No shops are open within 3 km. Clear “Within 3 km” to see all shops.',
  emptyNone: 'No shops yet. Check back later.',

  opening: 'Opening the shop…',
  statusOpen: 'Open',
  statusClosed: 'Closed',
  notTakingToday: 'Not taking orders today',
  currentShop: 'Current shop',
  selectShop: 'Choose',
  goShopping: 'Shop now',
  callShop: 'Call',
  straight: 'Straight-line {distance}',
  footerNote:
    'Distances are straight-line estimates for reference only; delivery availability is subject to the shop accepting the order.',
  shopsLoadFailed: 'Failed to load shops. Please refresh and try again.',

  mapLoading: 'Loading map…',
  mapFailed: 'Failed to load the map',
  mapErrorTitle: 'The map is not available',
  mapErrorNote: '{error}. The shop list still works — pick a shop from the list.',
  mapAriaLabel: 'Map of nearby shops',
  mapZoomIn: 'Zoom in',
  mapZoomOut: 'Zoom out',
  mapBackToMe: 'Back to my location',
  mapMeLabel: 'I am here',
  mapPinClosed: '{name} · Closed',

  notFoundTitle: 'This shop is not available right now',
  notFoundNote:
    'The shop does not exist, has not started taking orders yet, or is temporarily closed. Try another shop nearby.',
  backToShops: 'Back to nearby shops',
  menuLoadFailedTitle: 'Failed to load the menu',
  menuLoadFailedNote: 'Network error. Please refresh and try again.',
  productsLoadFailed: 'Failed to load items. Please refresh and try again.',

  distanceMeters: '{value} m',
  distanceKilometers: '{value} km',
  distanceUnknown: 'Distance unknown',
  hoursUnknown: 'Opening hours unknown'
};

export const shops = { zh, en };
