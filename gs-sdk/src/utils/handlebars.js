import Handlebars from 'handlebars/dist/handlebars.js';

Handlebars.registerHelper('recommendations', function (context, options) {
  let result = '';

  if (Array.isArray(context)) {
    for (let i = 0; i < context.length; i++) {
      const data = context[i];
      result += options.fn(data);
    }
  } else if (typeof context === 'object') {
    for (const key in context) {
      if (Object.prototype.hasOwnProperty.call(context, key)) {
        const data = context[key];
        result += options.fn(data);
      }
    }
  }

  return result;
});

Handlebars.registerHelper('chunk', function(array, size) {
  size = Number(size);
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
});

Handlebars.registerHelper('ne', function (a, b) {
  return a != b;
});

Handlebars.registerHelper('eq', function (a, b) {
  return a == b;
});

Handlebars.registerHelper('isYes', function (value) {
  return value === 'Yes' ? 'true' : 'false';
});

Handlebars.registerHelper('divide', function(a, b) {
  return a / b;
});

Handlebars.registerHelper('trunc', function (value) {
  const number = parseFloat(value);
  if (isNaN(number)) {
    return 0;
  }
  return Math.trunc(number);
});

Handlebars.registerHelper('applyDiscount', function (value, percentage, limit) {
  const amount = parseFloat(value);
  const discount = parseFloat(percentage);

  if (isNaN(amount) || isNaN(discount)) {
    return 0;
  }
  let discountAmount = amount * discount / 100;
  if (limit) {
    const limitDiscount = parseFloat(limit);
    discountAmount = amount * discount / 100 > limitDiscount ? limitDiscount : amount * discount / 100;
  }
  const discountedValue = amount - discountAmount;
  return discountedValue.toFixed(0);
});

Handlebars.registerHelper('slice', function (arr, start, end) {
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr.slice(start, end);
});

Handlebars.registerHelper('getDiscount', function (a, b) {
  const price = parseFloat(a);
  const listPrice = parseFloat(b);

  if (isNaN(price) || isNaN(listPrice) || price == listPrice) {
    return 0;
  }

  const discount = ((listPrice - price) / listPrice) * 100;
  return discount.toFixed(0);
});

function transformTemplate(template) {
  template = template.replace(/{{gs_recommendations}}/g, '{{{gs_recommendations}}}');

  const transformation1 = template.replace(/\{\{(?!\{)(?!#|\/|isYes)(.+?)\}\}/g, function (match, group1) {
    if (group1.includes('.')) {
      return match;
    }
    if (!group1.trim().startsWith('isYes')) {
      return `{{[${group1}]}}`;
    }
    return match;
  });

  const regex = /<!-- ignore_start -->[\s\S]*?<!-- ignore_end -->/g;
  const transformation2 = transformation1.replace(regex, '');

  return transformation2;
}

function addItemVariables(variables, recommendations) {
  let items = recommendations;

  variables.forEach(function (variable) {
    if (variable.type.id == 'product_property') {
      for (let i = 0; i < items.length; i++) {
        if (!['image'].includes(variable.value.id)) {
          items[i][variable.name] = items[i][variable.value.id];
        } else if (variable.value.id == 'image') {
          if (items[i] && variable && variable.name && items[i].imgs && items[i].imgs.length > 0) {
            items[i][variable.name] = items[i].imgs[0].url;
          }
        }
      }
    }
  });

  return {
    items
  };
}

export function renderTemplate(template, variablesArray, data) {
  if (!data) {
    data = {
      session: {}
    };
  }
  template = transformTemplate(template);

  let variablesObject = {};
  for (let variable of variablesArray) {
    if (!['gs_recoStrategy', 'gs_recoCount'].includes(variable.type.id)) {
      try {
        if (variable.type.id == 'list') {
          variablesObject[variable.name] = JSON.stringify(variable.value);
        } else {
          variablesObject[variable.name] = variable.value;
        }
      } catch (e) {
        console.error('renderTemplate variable error:', e);
      }
    }
  }

  if (data.hasRecommendationsBlockFlag) {
    const itemsObj = addItemVariables(variablesArray, data.recommendations);
    variablesObject = Object.assign({}, variablesObject, itemsObj);
  }

  if (data.session) {
    variablesObject['session'] = data.session;
  }
  variablesObject['gs_variantId'] = data.variantId;
  variablesObject['gs_targetId'] = data.target;
  variablesObject['gs_recoImpressionId'] = data.recoImpressionId;
  variablesObject['gs_contentName'] = data.contentName || '';
  variablesObject['gs_contentId'] = data.contentId || '';

  if (data.gs_recommendations) {
    variablesObject['gs_recommendations'] = data.gs_recommendations;
  }

  let compiledTemplate = Handlebars.compile(template, {
    helpers: {
      'eq': function (arg1, arg2) {
        return arg1 === arg2;
      }
    }
  });

  let renderedTemplate = compiledTemplate(variablesObject);
  return renderedTemplate;
}

export function renderRaw(template, data) {
  let compiledTemplate = Handlebars.compile(template, {
    helpers: {
      'eq': function (arg1, arg2) {
        return arg1 === arg2;
      }
    }
  });

  let renderedTemplate = compiledTemplate(data);
  return renderedTemplate;
}
