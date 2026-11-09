/** Only an explicit pending state; no simulated WeChat identity or OAuth success. */
export function WechatLoginOption() {
  return <div className="wechat-login-option">
    <div className="login-method-divider"><span>其他登录方式</span></div>
    <button className="wechat-login-button" type="button" disabled aria-describedby="wechat-login-status">使用当前微信登录 <span>待开通</span></button>
    <p id="wechat-login-status" className="notice">微信登录尚未开通，请先使用员工账号密码登录。</p>
  </div>;
}
