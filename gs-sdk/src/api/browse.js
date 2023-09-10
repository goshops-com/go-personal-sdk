export const install = (options) => {
    // Create a new script element
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/rrweb@latest/dist/record/rrweb-record.min.js';

    // Add an event listener to execute your code once the script is loaded
    script.onload = () => {
        // Your recording code
        let events = [];
        
        rrwebRecord.record({
            emit(event) {
                // push event into the events array
                events.push(event);
                console.log(events);
            },
        });
    };

    // Append the script to the document to start downloading and executing it
    document.body.appendChild(script);
};
