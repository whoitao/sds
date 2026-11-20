/** 关于页与帮助页的固定文案（站内功能说明，不是门店/商品数据） */
const zh = {
  aboutTitle: '关于捎点啥',
  aboutIntro:
    '捎点啥是给社区街坊用的买菜工具：打开就能看到附近正在营业的生鲜小店，挑好菜，送上门或者自己去店里拿。',
  aboutHowTitle: '怎么用',
  aboutHow1: '选店：在首页看附近门店，点「选他」进店。',
  aboutHow2: '挑菜：把要买的放进购物车，今天卖完的不能选。',
  aboutHow3: '结算：选送货到家或到店自提，再选付款方式。',
  aboutHow4: '取货 / 收货：到店自提，或者在家等门店送过来。',
  aboutSupportTitle: '目前支持',
  aboutSupport1: '就近找店：按定位看 3 公里内的门店，也可以只看营业中的。',
  aboutSupport2: '一店一单：不同门店的菜分开结算，同一家店可以一起提交。',
  aboutSupport3: '货到付款：收到菜或到店取货时付给门店；线上支付暂未开通。',
  aboutSlogan: '想让街坊买菜这件事，少走几步路。',

  helpTitle: '帮助',
  helpIntro: '照着下面几步就能买到菜；写到的功能都是站内现在能用的。',

  helpBuyTitle: '怎么买菜',
  helpBuy1:
    '打开首页的「附近的店」，点「打开定位」按当前位置找店；也可以用「3 公里内」「只看营业中」筛选，列表里会显示门店今天的营业时间。',
  helpBuy2: '选好门店点「选他」进店挑菜，挑好放进购物车；加购需要先登录。',
  helpBuy3:
    '门店休息中今天不接单，要等营业时间再来。标着「今天卖完了」的商品不能加购，也不会算进合计、不能结算。',

  helpPickupTitle: '怎么拿菜、怎么付钱',
  helpPickup1:
    '结算页选「送货到家」或「我去店里拿」。送货到家要先有收货地址，本页可直接换地址；到店自提会显示门店地址，做好后门店会通知你。',
  helpPickup2:
    '付款可选「收到菜再付钱」或「现在微信付」。线上支付暂未开通：选微信付不会发起扣款，订单会保留为待支付，请保留订单号并联系门店付款。',
  helpPickup3:
    '门店的营业时间和接单状态会影响能不能下单、什么时候送到；能不能送也以门店接单为准。',

  helpOrdersTitle: '订单',
  helpOrders1: '一店一单：不同门店的菜不能合成一单，需要分开结算；同一家店的菜可以一起提交。',
  helpOrders2:
    '订单状态有待支付、待接单、备货中、配送中、待自提、已完成、退款中、已取消、已退款，以订单页实际显示为准。',
  myOrders: '我的订单',
  helpOrders3Pre: '顶栏头像菜单里点「我的订单」，或直接打开',
  helpOrders3Post:
    '，点任一订单能看商品、地址或自提门店、支付方式和当前状态。订单信息以门店确认为准。',
  helpOrders4: '需要取消或改单，请在营业时间内直接联系门店。',

  helpAccountTitle: '账号',
  helpAccount1: '用手机号和短信验证码登录；新手机号在「注册」里填手机号、验证码和姓名即可开通。',
  helpAccount2Pre: '在',
  profileName: '个人信息',
  helpAccount2Post:
    '里可以改用户名（2–20 个字，不能带空格）、上传或移除头像（JPG / PNG / WebP / GIF，2MB 以内），也可以用手机验证码重置密码。',
  helpAccount3Pre: '在',
  addressesName: '收货地址',
  helpAccount3Post:
    '里新增、编辑、删除地址，并设一个默认地址；下单默认用默认地址，结算页还能临时换。',

  helpProblemsTitle: '遇到问题',
  helpProblems1:
    '站内暂时没有在线客服和电话客服入口；订单有问题先看订单详情里的门店、地址和状态，营业时间内到门店沟通最快。',
  helpProblems2: '列表里的距离是直线距离，仅供参考；实际能不能送，以门店接单为准。'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  aboutTitle: 'About 捎点啥',
  aboutIntro:
    '捎点啥 is a grocery-shopping tool for the neighbourhood: open it to see nearby fresh-food shops that are open now, pick what you need, and have it delivered or pick it up yourself.',
  aboutHowTitle: 'How it works',
  aboutHow1: 'Choose a shop: browse nearby shops on the home page and tap “Choose” to enter.',
  aboutHow2: 'Pick groceries: add items to the cart. Items sold out today cannot be selected.',
  aboutHow3: 'Checkout: choose home delivery or store pickup, then pick a payment method.',
  aboutHow4: 'Pick up / receive: collect at the store, or wait at home for delivery.',
  aboutSupportTitle: 'What is supported',
  aboutSupport1: 'Find a nearby shop: see shops within 3 km of your location, or show open shops only.',
  aboutSupport2:
    'One order per shop: items from different shops are checked out separately; items from the same shop can be submitted together.',
  aboutSupport3:
    'Pay on delivery: pay the shop when you receive or pick up your groceries. Online payment is not available yet.',
  aboutSlogan: 'A few fewer steps to buy groceries in the neighbourhood.',

  helpTitle: 'Help',
  helpIntro:
    'Follow the steps below to buy groceries. Everything described here works in the site today.',

  helpBuyTitle: 'How to buy groceries',
  helpBuy1:
    'Open “Nearby shops” on the home page and tap “Turn on location” to find shops around you. You can also filter by “Within 3 km” or “Open only”; each shop shows today’s opening hours.',
  helpBuy2:
    'Choose a shop and tap “Choose” to enter, then add items to the cart. You need to sign in before adding items.',
  helpBuy3:
    'A shop that is currently closed is not taking orders today; come back during opening hours. Items marked “Sold out today” cannot be added, are excluded from the total and block checkout.',

  helpPickupTitle: 'Pickup and payment',
  helpPickup1:
    'On the checkout page choose “Deliver to my address” or “I will pick it up”. Delivery requires a saved address, which you can change on that page; pickup shows the shop address and the shop will notify you when your order is ready.',
  helpPickup2:
    'For payment you can choose “Pay when I receive it” or “Pay with WeChat now”. Online payment is not available yet: choosing WeChat will not charge you, the order stays pending payment, so keep the order number and contact the shop to pay.',
  helpPickup3:
    'A shop’s opening hours and order status affect whether you can order and when it arrives; delivery availability is also subject to the shop accepting the order.',

  helpOrdersTitle: 'Orders',
  helpOrders1:
    'One order per shop: items from different shops cannot be combined and must be checked out separately; items from the same shop can be submitted together.',
  helpOrders2:
    'Order statuses include pending payment, awaiting confirmation, preparing, out for delivery, ready for pickup, completed, refunding, cancelled and refunded; the order page shows the actual status.',
  myOrders: 'My orders',
  helpOrders3Pre: 'Tap “My orders” in the avatar menu at the top, or open ',
  helpOrders3Post:
    ' directly. Tap any order to see items, address or pickup shop, payment method and current status. Order details are subject to shop confirmation.',
  helpOrders4: 'To cancel or change an order, contact the shop directly during opening hours.',

  helpAccountTitle: 'Account',
  helpAccount1:
    'Sign in with your mobile number and an SMS code. New numbers can register with a phone number, verification code and name.',
  helpAccount2Pre: 'In ',
  profileName: 'Profile',
  helpAccount2Post:
    ' you can change your name (2–20 characters, no spaces), upload or remove an avatar (JPG / PNG / WebP / GIF, up to 2 MB), and reset your password with an SMS code.',
  helpAccount3Pre: 'In ',
  addressesName: 'Addresses',
  helpAccount3Post:
    ' you can add, edit and delete addresses and set a default one. Orders use the default address by default, and you can switch it temporarily on the checkout page.',

  helpProblemsTitle: 'Having problems?',
  helpProblems1:
    'There is no online or phone support in the site yet. If an order has a problem, first check the shop, address and status in the order details; talking to the shop during opening hours is fastest.',
  helpProblems2:
    'Distances shown in the list are straight-line distances for reference only; whether delivery is possible is subject to the shop accepting the order.'
};

export const site = { zh, en };
