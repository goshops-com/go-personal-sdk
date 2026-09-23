import { subscribeToTask } from './queue'

// A page that opens with the cursor already outside (or on the tab strip) would
// otherwise fire on load.
export const EXIT_INTENT_ARM_DELAY_MS = 1000;

/**
 * "Al intentar irse". Until 2026-09 this set a `beforeunload` returnValue: it
 * never showed the popup at all, only the browser's own "Leave site?" dialog —
 * on checkout pages too.
 *
 * Fires once, on the first of:
 *  - the cursor leaving the window through the top (toward the tabs, the URL
 *    bar or the close button), the usual desktop signal;
 *  - the visitor coming back after switching to another tab or app — phones
 *    have no cursor, and this is the cleanest "they left" signal there. The
 *    back-button trick (pushing a fake history entry) is avoided on purpose: it
 *    pollutes history and fights the stores' SPA routers.
 */
export const onExitIntent = (fire, { armDelayMs = EXIT_INTENT_ARM_DELAY_MS } = {}) => {
    let done = false;
    let armed = false;
    let wentAway = false;

    const onMouseOut = (e) => {
        // relatedTarget is null only when the pointer left the document itself.
        if (!armed || e.relatedTarget || e.clientY > 0) return;
        trigger();
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            wentAway = true;
        } else if (wentAway) {
            trigger();
        }
    };

    const trigger = () => {
        if (done) return;
        done = true;
        document.removeEventListener('mouseout', onMouseOut);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        fire();
    };

    setTimeout(() => { armed = true; }, armDelayMs);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('visibilitychange', onVisibilityChange);
};

export const suscribe = (content, cb) => {
    const trigger = content.trigger;
    const html = content.contentValue.html;
    const js = content.contentValue.js;
    const contentKey = content.key;

    if (!trigger || !trigger.id) {
      cb(html, js);
      return;
    }

    if (trigger.id === 'wait') {
      const seconds = parseInt(trigger.value) || 0;
  
      return setTimeout(() => {
        cb(html, js); // Call the callback function after the specified number of seconds
      }, seconds * 1000);
    }else if (trigger.id === 'exit_intent') {
        onExitIntent(() => cb(html, js));
    }else if (trigger.id === 'click_element') {
        // Get the element using the selector from trigger.value
        const element = document.querySelector(trigger.value);
    
        if (element) {
          // Add a click event listener to the element
          element.addEventListener('click', () => {
            cb(html, js); // Call the callback function when the element is clicked
          });
        }
    }else if (trigger.id === 'mouseover_element') {
        const element = document.querySelector(trigger.value);
        if (element) {
          element.addEventListener('mouseover', () => {
            cb(html, js); // Call the callback function when the mouse is moved over the element
          });
        }
    }else if (trigger.id === 'scroll') {
        const threshold = parseInt(trigger.value) || 50;
        let fired = false;
        const onScroll = () => {
          if (fired) return;
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
          if (docHeight > 0 && (scrollTop / docHeight) * 100 >= threshold) {
            fired = true;
            window.removeEventListener('scroll', onScroll);
            cb(html, js);
          }
        };
        window.addEventListener('scroll', onScroll);
        onScroll();
    }else if (trigger.id === 'page_load'){
        console.log('page_load');
        cb(html, js);
    }else if (trigger.id === 'interaction'){
      // ev.on('interaction', function(interactionData){
      //   console.log('interaction data event received', interactionData);
      //   if (interactionData.event == trigger.value){
      //     cb(html, js);
      //   }
      // })
      console.log('trigger interaction')
      const params = { contentKey: contentKey + '' };
      subscribeToTask('interaction-' + trigger.value.id, function(params){
        console.log('f', params);
        window.gsSDK.getContent(params.contentKey, { forceShow: true});
      }, params);

    }
}