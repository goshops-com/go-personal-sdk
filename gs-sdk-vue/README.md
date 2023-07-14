# Introduction

@goshops/gs-sdk-vue is a Vue.js wrapper for the @goshops/gs-sdk JavaScript SDK. It allows you to easily integrate the GS SDK into your Vue.js applications.

# Installation
You can install the @goshops/gs-sdk-vue and the @goshops/gs-sdk packages via npm:

```
npm install --save @goshops/gs-sdk @goshops/gs-sdk-vue
```

# Usage

To use @goshops/gs-sdk-vue in your Vue.js app, you need to install it as a Vue.js plugin:

```
import Vue from 'vue';
import GSSDKVue from '@goshops/gs-sdk-vue';

Vue.use(GSSDKVue, { clientId: 'your-client-id' });
```

Then, in your Vue.js components, you can access the GS SDK via this.$gsSDK:

```
export default {
  created() {
    this.$gsSDK.login('userId')
      .then(response => {
        console.log(response);
      })
      .catch(error => {
        console.error(error);
      });
  }
}
```

If you want to use async/await syntax:

export default {
  async created() {
    try {
      const response = await this.$gsSDK.login('userId');
      console.log(response);
    } catch (error) {
      console.error(error);
    }
  }
}

Note: Replace 'your-client-id' with your actual client ID.

# Methods

@goshops/gs-sdk-vue adds an instance of the GS SDK to Vue's prototype, and you can access the following methods on this.$gsSDK:

* login(userId)
* logout()
* addInteraction(interaction)
* getContent(contentId)

Please refer to the @goshops/gs-sdk documentation for detailed information about these methods.