import { httpPost } from "../utils/http";

export const install = (options) => {
    let eventsData = [];

    let lastRecordedPosition = null;
    let maxScrollDepth = 0;    
    
    let initialDevicePixelRatio = window.devicePixelRatio;

    const MIN_DISTANCE = 10; // pixels

    function getDistance(point1, point2) {
        return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
    }

    function throttled(delay, fn) {
        let lastCall = 0;
        return function (...args) {
            const now = (new Date).getTime();
            if (now - lastCall < delay) {
                return;
            }
            lastCall = now;
            return fn(...args);
        }
    }

    document.addEventListener('mousemove', throttled(100, function(e) {
        let x = e.pageX;
        let y = e.pageY;
        let timestamp = new Date().toISOString();
        const url = window.location.href;

        if (!lastRecordedPosition) {
            lastRecordedPosition = { x: x, y: y };
            eventsData.push({x: x, y: y, type: 'move', timestamp: timestamp, url});
        } else if (getDistance(lastRecordedPosition, {x: x, y: y}) > MIN_DISTANCE) {
            lastRecordedPosition = { x: x, y: y };
            eventsData.push({x: x, y: y, type: 'move', timestamp: timestamp, url});
        }
    }));

    document.addEventListener('click', function(e) {
        let x = e.pageX;
        let y = e.pageY;
        const url = window.location.href;

        let timestamp = new Date().toISOString();
        eventsData.push({x: x, y: y, type: 'click', timestamp: timestamp, url});
    });

    document.addEventListener('scroll', function() {
        const currentBottomEdge = window.scrollY + window.innerHeight;
        if (currentBottomEdge > maxScrollDepth) {
            maxScrollDepth = currentBottomEdge;
        }

        let timestamp = new Date().toISOString();
        const url = window.location.href;

        eventsData.push({ 
            type: 'scroll', 
            position: window.scrollY, 
            maxReached: maxScrollDepth, 
            timestamp: timestamp,
            url
        });
    });

    function sendData() {
        let viewportWidth = window.innerWidth;
        let viewportHeight = window.innerHeight;
        let timestamp = new Date().toISOString();

        let dataToSend = {
            maxScrollDepth: maxScrollDepth,
            viewportSize: { width: viewportWidth, height: viewportHeight, timestamp: timestamp },
            eventsData
        };

        if (eventsData.length > 0){
            httpPost('/browse/collect', {events: eventsData})
        }
        maxScrollDepth = 0;
        eventsData = [];
    }

    // Page Transition (user leaving the page)
    window.addEventListener('beforeunload', function() {
        let timestamp = new Date().toISOString();
        const url = window.location.href;
        eventsData.push({ type: 'page_transition', timestamp: timestamp, url });
        
        // You might want to make an immediate call to your server here if the data is crucial
        sendData();
    });

    window.addEventListener('resize', function() {
        let currentRatio = window.devicePixelRatio;
        const url = window.location.href;
        if (currentRatio !== initialDevicePixelRatio) {
            let timestamp = new Date().toISOString();
            eventsData.push({
                type: 'zoom_change',
                previousRatio: initialDevicePixelRatio,
                currentRatio: currentRatio,
                timestamp: timestamp,
                url
            });
            initialDevicePixelRatio = currentRatio;
        }
    });

    document.addEventListener('focus', function(e) {
        const url = window.location.href;
        if (e.target && e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            let timestamp = new Date().toISOString();
            e.target.dataset.focusTime = timestamp; // Save the focus time on the element itself
            eventsData.push({
                type: 'form_focus',
                field: e.target.name || e.target.id,
                timestamp: timestamp,
                url
            });
        }
    }, true);

    document.addEventListener('blur', function(e) {
        const url = window.location.href;
        if (e.target && e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            let timestamp = new Date().toISOString();
            let focusTime = e.target.dataset.focusTime;
            if (focusTime) {
                let duration = new Date(timestamp) - new Date(focusTime);
                eventsData.push({
                    type: 'form_blur',
                    field: e.target.name || e.target.id,
                    timestamp: timestamp,
                    duration: duration,
                    url
                });
            }
        }
    }, true);

    document.addEventListener('change', function(e) {
        const url = window.location.href;
        if (e.target && e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            let timestamp = new Date().toISOString();
            eventsData.push({
                type: 'form_change',
                field: e.target.name || e.target.id,
                value: e.target.value,
                timestamp: timestamp,
                url
            });
        }
    }, true);

    setInterval(function(){
        sendData()
    },5*1000)
}