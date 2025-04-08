import { suscribe } from "./trigger";

const queueKey = 'gs_queue';
const subscriberKey = 'gs_suscribers';

export const addToQueue = (data) => {
  const queue = JSON.parse(localStorage.getItem('queue') || '[]');
  queue.push(data);
  localStorage.setItem(queueKey, JSON.stringify(queue));
}

export const subscribeToTask = (taskType, callback, params) => {
  const subscribers = JSON.parse(localStorage.getItem(subscriberKey) || '{}');

  if (!subscribers[taskType]) {
    subscribers[taskType] = [];
  }

  // Add callback to subscribers of the task type.
  // Note: For simplicity, we're directly storing the function as a string.
  // In a real-world application, this might require more sophisticated handling.
  subscribers[taskType].push({
    callback: callback.toString(),
    params: params
  });

  localStorage.setItem(subscriberKey, JSON.stringify(subscribers));
}

export const subscribeQueue = () => {

  setInterval(() => {

    const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
    const subscribers = JSON.parse(localStorage.getItem(subscriberKey) || '{}');

    if (queue.length > 0) {

      const task = queue[0];
      const expirationDate = task.expirationDate;
      const now = new Date().getTime()
      if (now < expirationDate) {

        // Find subscribers to this task.

        const taskSubscribers = subscribers[task.type] || [];

        // Execute all the subscribers.
        taskSubscribers.forEach(subscriber => {
          const deserializedFunc = eval('(' + subscriber.callback + ')');
          deserializedFunc(subscriber.params);
        });

        // Clear subscribers for this task type to ensure they are executed only once.
        delete subscribers[task.type];
        localStorage.setItem(subscriberKey, JSON.stringify(subscribers));
      }

      // Remove the task from the queue.
      queue.shift();
      localStorage.setItem(queueKey, JSON.stringify(queue));
    }

  }, 500); // Checks localStorage every 500ms

}