export const suscribe = (content, cb) => {
    const trigger = content.trigger;
    const html = content.contentValue.html;
    const js = content.contentValue.js;

    if (trigger.id === 'wait') {
      const seconds = parseInt(trigger.value) || 0;
  
      setTimeout(() => {
        cb(html, js); // Call the callback function after the specified number of seconds
      }, seconds * 1000);
    }

    cb(html, js);
}
  