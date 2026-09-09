
# Introduction

`@goshops/gs-sdk` is a JavaScript SDK that enables seamless integration with the GoShops platform.

# Installation

You can install `@goshops/gs-sdk` package via npm:

```bash
npm install --save @goshops/gs-sdk
```

Alternatively, you can include it in your project using a script tag with the CDN link:

```html
<script src="https://unpkg.com/@goshops/gs-sdk@latest"></script>
```

To specify a version change latest with the version number from https://www.npmjs.com/package/@goshops/gs-sdk?activeTab=versions

# Usage

## With npm:

You can import @goshops/gs-sdk in your JavaScript file:

```javascript
import GSSDK from '@goshops/gs-sdk';

const gsSDK = new GSSDK('your-client-id');
```

## With CDN:

If you included the SDK using the script tag, you can access the GSSDK constructor directly:

```javascript
const gsSDK = new window.GSSDK('your-client-id');
```

In both cases, you can then use the GS SDK to call various methods:

```javascript
gsSDK.login('userId')
  .then(response => {
    console.log(response);
  })
  .catch(error => {
    console.error(error);
  });
```

Or using async/await:


```javascript
try {
  const response = await gsSDK.login('userId');
  console.log(response);
} catch (error) {
  console.error(error);
}
```

Note: Replace 'your-client-id' with your actual client ID.

# Methods

*@goshops/gs-sdk* exposes the following methods:

* login(userId)
* logout()
* addInteraction(interaction)
* getContent(contentId)

Refer to the official API documentation for detailed information about these methods.



# Content priority and "seen personalization" rule

Each personalization can have an optional `priority` (integer, `1` loads first). It only changes the load when the page has **at least two different priority values**: personalizations with priority are then resolved one at a time, from lowest to highest (ties in parallel), while the ones without priority load in parallel as always. With no priority, or all the same, the load is exactly the usual one (everything in parallel).

The SDK keeps, per session, the `_id` of every personalization it served (`gs_seen_contents` in localStorage, dropped when the session changes) and sends it on every content request as `context.seenContents`. The targeting rule "Seen personalization" (`seen_content`) reads that list, so a lower-priority personalization can say "show only if the visitor did not see personalization X" and it is evaluated with what the previous step of the chain actually served.

```javascript
gsSDK.getSeenContents(); // ['66a0...01', '66a0...02']
```
