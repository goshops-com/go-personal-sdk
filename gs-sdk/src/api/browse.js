import { getToken } from '../utils/storage';

export const install = (options) => {
    // Create a new script element
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/rrweb@latest/dist/record/rrweb-record.min.js';

    // Add an event listener to execute your code once the script is loaded
    script.onload = async () => {
        // Your recording code
        let events = [];
        
        rrwebRecord({
            emit(event) {
                // push event into the events array
                events.push(event);
                console.log(events);
            },
        });

        const token = getToken();

        // this function will send events to the backend and reset the events array
        async function save() {
            const body = JSON.stringify({ events });
            const response = await fetch(`https://browse.go-shops.workers.dev`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: body,
              });  
        }
        
        // save events every 10 seconds
        setInterval(save, 10 * 1000);
    };

    // Append the script to the document to start downloading and executing it
    document.body.appendChild(script);
};
