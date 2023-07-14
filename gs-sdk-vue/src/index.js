import GSSDK from '@goshops/gs-sdk'; // import your SDK

export default {
  install(Vue, options) {
    Vue.prototype.$gsSDK = new GSSDK(options.clientId); // add an instance of your SDK to Vue prototype
  }
};
