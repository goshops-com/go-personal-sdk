
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
* setEmailSubscription(optIn)
* addInteraction(interaction)
* getContent(contentId)

Refer to the official API documentation for detailed information about these methods.

## Email subscriptions

Identify the customer before changing their email preference. Both calls use the
existing SDK session token; no additional credentials are needed.

```javascript
await window.gsSDK.login(email, { email });
await window.gsSDK.setEmailSubscription(false); // Reject email notifications
await window.gsSDK.setEmailSubscription(true);  // Accept email notifications
```

`setEmailSubscription` requires a boolean. It persists the email channel's `optIn`
and recalculates email reachability, preserving other channels. It does not erase
the email, end the session, or bypass delivery checks for invalid addresses and
bounces. A subsequent login preserves the saved opt-out. An anonymous session or
a missing customer is rejected by Discover. Handle a rejected promise as a failed
save; do not show the preference as saved until the request succeeds.

Deploy Discover's `/channel/email-subscription` before publishing this SDK.
Then connect the store's notification checkbox to the new
method. This preference concerns receiving emails, not deleting shared data.



# Content priority and "seen personalization" rule

Each personalization can have an optional `priority` (integer, `1` loads first). It only changes the load when the page has **at least two different priority values**: personalizations with priority are then resolved one at a time, from lowest to highest (ties in parallel), while the ones without priority load in parallel as always. With no priority, or all the same, the load is exactly the usual one (everything in parallel).

The SDK keeps, per session, the `_id` of every personalization it served (`gs_seen_contents` in localStorage, dropped when the session changes) and sends it on every content request as `context.seenContents`. The targeting rule "Seen personalization" (`seen_content`) reads that list, so a lower-priority personalization can say "show only if the visitor did not see personalization X" and it is evaluated with what the previous step of the chain actually served.

```javascript
gsSDK.getSeenContents(); // ['66a0...01', '66a0...02']
```
