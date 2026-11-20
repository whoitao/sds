/** 登录 / 注册页与登录表单文案 */
const zh = {
  brand: '捎点啥',
  registerBrand: '欢迎来捎点啥',
  loginSlogan: '买菜不费劲，送到家门口',
  registerSlogan: '填三样就能用，以后用手机号登录',

  perkShopTitle: '就在家附近的店',
  perkShopDesc: '挑好菜，店里送上门，也能自己去拿',
  perkBigTitle: '字大、按钮大',
  perkBigDesc: '每一步只问一件事，不怕点错',
  perkHeartTitle: '不会用也不要紧',
  perkHeartDesc: '可以让家人帮忙，或到店里找店员',

  stepPhoneTitle: '手机号',
  stepPhoneDesc: '店里有事会打这个电话找您',
  stepCodeTitle: '验证码',
  stepCodeDesc: '点「获取验证码」，把收到的 6 位数填进去',
  stepNameTitle: '姓名',
  stepNameDesc: '送菜时店员这样称呼您',

  registerTab: '注册',
  phoneLabel: '手机号',
  phonePlaceholder: '请输入手机号',
  codeLabel: '验证码',
  codePlaceholder: '请输入 6 位验证码',
  nameLabel: '姓名',
  namePlaceholder: '请输入姓名',
  sendCode: '获取验证码',
  sendingCode: '发送中…',
  resendIn: '{count} 秒后重发',
  codeSentNote: '验证码已发送。开发环境验证码固定为 {code}（临时方案）',

  phoneRequired: '请输入手机号',
  phoneInvalid: '请输入正确的 11 位手机号',
  codeRequired: '请输入验证码',
  codeInvalid: '请输入 6 位数字验证码',
  codeMismatch: '验证码不正确，开发环境请输入 {code}',
  nameRequired: '请输入姓名',

  loginPending: '登录中…',
  registerPending: '注册中…',
  registerSubmit: '注册并登录',
  agreementPrefix: '注册即表示同意',
  terms: '《用户协议》',
  agreementAnd: '和',
  privacy: '《隐私政策》',
  firstTimePrefix: '第一次使用？点上面的「',
  firstTimeSuffix: '」',
  registeredPrefix: '已经注册过？点上面的「',
  registeredSuffix: '」',
  devNote: '现在是开发体验版：验证码固定为 {code}，不会真的发短信；正式上线后会改成短信验证码。',

  loadingCode: '正在发送验证码…',
  loadingLogin: '正在登录…',
  loadingRegister: '正在注册…',
  sendCodeFailed: '验证码发送失败，请稍后再试',
  loginFailed: '登录失败，请稍后再试'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  brand: '捎点啥',
  registerBrand: 'Welcome to 捎点啥',
  loginSlogan: 'Groceries made easy, delivered to your door',
  registerSlogan: 'Fill in three things, then sign in with your phone number',

  perkShopTitle: 'Shops near your home',
  perkShopDesc: 'Pick your groceries, get them delivered, or collect at the shop',
  perkBigTitle: 'Big text, big buttons',
  perkBigDesc: 'One question at a time, so it is hard to tap the wrong thing',
  perkHeartTitle: 'Not tech-savvy? That is fine',
  perkHeartDesc: 'Ask family for help, or ask a staff member in the shop',

  stepPhoneTitle: 'Phone number',
  stepPhoneDesc: 'The shop will call this number if needed',
  stepCodeTitle: 'Verification code',
  stepCodeDesc: 'Tap “Get code” and enter the 6-digit code you receive',
  stepNameTitle: 'Name',
  stepNameDesc: 'This is how the shop will greet you on delivery',

  registerTab: 'Sign up',
  phoneLabel: 'Phone number',
  phonePlaceholder: 'Enter your phone number',
  codeLabel: 'Verification code',
  codePlaceholder: 'Enter the 6-digit code',
  nameLabel: 'Name',
  namePlaceholder: 'Enter your name',
  sendCode: 'Get code',
  sendingCode: 'Sending…',
  resendIn: 'Resend in {count}s',
  codeSentNote: 'Code sent. In development the code is fixed at {code} (temporary).',

  phoneRequired: 'Please enter your phone number',
  phoneInvalid: 'Please enter a valid 11-digit phone number',
  codeRequired: 'Please enter the verification code',
  codeInvalid: 'Please enter the 6-digit code',
  codeMismatch: 'Incorrect code. In development, enter {code}',
  nameRequired: 'Please enter your name',

  loginPending: 'Signing in…',
  registerPending: 'Signing up…',
  registerSubmit: 'Sign up and sign in',
  agreementPrefix: 'By signing up you agree to',
  terms: 'Terms of Service',
  agreementAnd: 'and',
  privacy: 'Privacy Policy',
  firstTimePrefix: 'First time here? Tap “',
  firstTimeSuffix: '” above.',
  registeredPrefix: 'Already registered? Tap “',
  registeredSuffix: '” above.',
  devNote:
    'This is a development preview: the code is fixed at {code} and no text message is sent. SMS verification will replace it at launch.',

  loadingCode: 'Sending verification code…',
  loadingLogin: 'Signing in…',
  loadingRegister: 'Signing up…',
  sendCodeFailed: 'Could not send the code. Please try again later.',
  loginFailed: 'Sign-in failed. Please try again later.'
};

export const auth = { zh, en };
