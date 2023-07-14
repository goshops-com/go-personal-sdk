# Introduction

`@goshops/gs-sdk-react` is a React.js hook wrapper for the `@goshops/gs-sdk` JavaScript SDK. It provides an easy way to integrate the GS SDK into your React applications.

# Installation

You can install `@goshops/gs-sdk-react` and `@goshops/gs-sdk` packages via npm:

```bash
npm install --save @goshops/gs-sdk @goshops/gs-sdk-react
```

# Usage

Import the *useGSSDK* hook from @goshops/gs-sdk-react and use it in your React components:

```javascript
import React, { useEffect } from 'react';
import useGSSDK from '@goshops/gs-sdk-react';

function App() {
  const gsSDK = useGSSDK('your-client-id');

  useEffect(() => {
    if (!gsSDK) return;
    
    const fetchData = async () => {
      try {
        const loginResponse = await gsSDK.login('userId');
        console.log(loginResponse);

        const interactionResponse = await gsSDK.addInteraction({ event: 'cart', item: "1233" });
        console.log(interactionResponse);

        const contentResponse = await gsSDK.getContent('content-id');
        console.log(contentResponse);

        const logoutResponse = await gsSDK.logout();
        console.log(logoutResponse);
      } catch (error) {
        console.error(error);
      }
    };

    fetchData();
  }, [gsSDK]);

  return (
    // ...
  );
}

export default App;
```

Note: Replace *'your-client-id'* with your actual client ID.


# Methods
@goshops/gs-sdk-react provides a hook that returns an instance of the GS SDK, which exposes the following methods:

* login(username)
* logout()
* addInteraction(interaction)
* getContent(contentId)

Please refer to the @goshops/gs-sdk documentation for detailed information about these methods.
