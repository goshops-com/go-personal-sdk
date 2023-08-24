export const suscribe = (content, ev, cb) => {
    const trigger = content.trigger;
    const html = content.contentValue.html;
    const js = content.contentValue.js;

    if (trigger.id === 'wait') {
      const seconds = parseInt(trigger.value) || 0;
  
      return setTimeout(() => {
        cb(html, js); // Call the callback function after the specified number of seconds
      }, seconds * 1000);
    }else if (trigger.id === 'exit_intent') {
        // Attach an event listener to the beforeunload event
        return window.addEventListener('beforeunload', (e) => {
          // You can also show a confirmation dialog to the user
          const confirmationMessage = js || 'Are you sure you want to leave?';
          (e || window.event).returnValue = confirmationMessage; // For old browsers
          return confirmationMessage;
        });
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
    }else if (trigger.id === 'page_load'){
        cb(html, js);
    }else if (trigger.id === 'interaction'){
      ev.on('interaction', function(interactionData){
        console.log('interaction data event received', interactionData);
        cb(html, js);
      })
    }

    
}