import { httpPut } from './http';

export const setupContentSelector = async (contentId) => {

  window.contentId = contentId;
  window.selected;

  let style = document.createElement('style');
  document.head.appendChild(style);
  let tooltip = document.createElement('div');
  tooltip.style.position = 'fixed';
  tooltip.style.bottom = '10px';
  tooltip.style.right = '10px';
  tooltip.style.padding = '5px';
  tooltip.style.backgroundColor = 'white';
  tooltip.style.border = '1px solid black';
  tooltip.style.zIndex = '10000';
  document.body.appendChild(tooltip);

  // Notification element
  let notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.top = '10px';
  notification.style.right = '10px';
  notification.style.padding = '10px';
  notification.style.backgroundColor = '#4caf50';
  notification.style.color = 'white';
  notification.style.zIndex = '10000';
  notification.style.display = 'none';  // Initially hidden
  document.body.appendChild(notification);


  let uniqueId = 0;

  function getPath(element) {
    let path = [], current = element;
    while (current !== document.body) {
      path.unshift(`${current.nodeName}:nth-child(${Array.prototype.indexOf.call(current.parentNode.children, current) + 1})`);
      current = current.parentNode;
    }
    return 'body > ' + path.join(' > ');
  }

  function highlight(element) {
    if (element.id) {
      if (!element.getAttribute('data-original-id')) {
        element.setAttribute('data-original-id', element.id);
      }
    } else {
      element.id = 'temp_id_' + uniqueId++;
    }
    style.textContent = `#${element.id} { outline: 2px solid red !important; }`;

    let identifier = "";
    if (element.getAttribute('data-original-id')) {
      identifier = "#" + element.getAttribute('data-original-id');
    } else if (element.className) {
      identifier = "." + element.className;
    } else {
      identifier = getPath(element);
    }
    window.selected = identifier;
    tooltip.textContent = 'Selected: ' + identifier;
  }

  function showNotification(message) {
    notification.textContent = message;
    notification.style.display = 'block';  // Show notification
    setTimeout(function() {
      notification.style.display = 'none';  // Hide after 3 seconds
    }, 10000);
  }


  function addEventListenersToAllElements(element) {
    element.addEventListener('mouseover', function(event) {
      event.stopPropagation();
      highlight(element);
    });

    element.addEventListener('mouseout', function(event) {
      event.stopPropagation();
      if (element.id.startsWith('temp_id_')) {
        element.id = '';
      }
      style.textContent = '';
      tooltip.textContent = '';
    });

    element.addEventListener('click', async function(event) {
      event.stopPropagation();
      event.preventDefault();

      console.log('window.selected', window.selected);
      await httpPut(`/configure/content/${window.contentId}/selector`, {selector: window.selected});
    //   alert(`Element selected: ${window.selected} \n Close this Window.`);
        showNotification(`Success! The element '${window.selected}' has been selected. You may now close this window.`);

    });

    for (let child of element.children) {
      addEventListenersToAllElements(child);
    }
  }

  addEventListenersToAllElements(document.body);
}