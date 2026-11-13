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
  // Un suscriptor por contenido: cada carga de pagina vuelve a suscribir al
  // mismo, y sin esto al dispararse el evento se pedia una vez por cada carga.
  if (params && params.contentKey != null) {
    subscribers[taskType] = subscribers[taskType].filter(
      (subscriber) => subscriber?.params?.contentKey !== params.contentKey,
    );
  }

  subscribers[taskType].push({
    callback: callback.toString(),
    params: params
  });

  localStorage.setItem(subscriberKey, JSON.stringify(subscribers));
}

let queueTimer = null;

export const subscribeQueue = () => {

  // Cada init vuelve a pasar por aca: un solo intervalo por pagina.
  if (queueTimer !== null) {
    return;
  }

  queueTimer = setInterval(() => {

    // Casi siempre la cola esta vacia: se sale sin parsear nada.
    const rawQueue = localStorage.getItem(queueKey);
    if (!rawQueue || rawQueue === '[]') {
      return;
    }

    const queue = JSON.parse(rawQueue);

    if (queue.length > 0) {

      const subscribers = JSON.parse(localStorage.getItem(subscriberKey) || '{}');

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