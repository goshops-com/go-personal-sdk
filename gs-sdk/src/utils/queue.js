const queueKey = 'gs_queue';
const subscriberKey = 'gs_suscribers';

export const addToQueue = (data) => {
  const queue = JSON.parse(localStorage.getItem('queue') || '[]');
  queue.push(data);
  localStorage.setItem(queueKey, JSON.stringify(queue));
  console.log('task added to queue');
}

export const subscribeToTask = (taskType, callback) => {
  console.log('subscribeToTask')
  const subscribers = JSON.parse(localStorage.getItem(subscriberKey) || '{}');
  
  if (!subscribers[taskType]) {
    subscribers[taskType] = [];
  }

  // Add callback to subscribers of the task type.
  // Note: For simplicity, we're directly storing the function as a string.
  // In a real-world application, this might require more sophisticated handling.
  subscribers[taskType].push(callback.toString());
  localStorage.setItem(subscriberKey, JSON.stringify(subscribers));
  console.log(JSON.stringify(subscribers));
}

export const subscribeQueue = () => {

  console.log('subscribeQueue');

  window.addEventListener('storage', function(event) {

    console.log('subscribeQueue', event.key);
    
    if (event.key === queueKey) {
        const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
        const subscribers = JSON.parse(localStorage.getItem(subscriberKey) || '{}');

        if (queue.length > 0) {
            console.log('Processing:', queue[0]);

            const task = queue[0];
            const expirationDate = task.expirationDate;

            if (expirationDate < new Date().getTime()) {
              
              // Find subscribers to this task.
              const taskSubscribers = subscribers[task.type] || [];

              // Execute all the subscribers.
              taskSubscribers.forEach(subscriber => {
                // Convert the string back to a function and execute it.
                new Function('return ' + subscriber)()(task);
              });

              // Clear subscribers for this task type to ensure they are executed only once.
              delete subscribers[task.type];
              localStorage.setItem(subscriberKey, JSON.stringify(subscribers));
            }

            // Remove the task from the queue.
            queue.shift();
            localStorage.setItem(queueKey, JSON.stringify(queue));
        }
    }
});
}