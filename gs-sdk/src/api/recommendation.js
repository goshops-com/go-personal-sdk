
import { httpGet, httpPost, httpPatch } from '../utils/http';

export const bestProducts = async (options = {}) => {
  let q = '';
  if (options.includeImpressionId){
    q += 'includeImpressionId=true';
  }
  return await httpGet(`/recommendations/best-products?${q}`);
};

export const byContext = async (options = {}) => {
  let context = options.context;
  const filter = options.filter;
  const options = options.options;

  const currentPageContext = window.gsConfig.options.context || {};
  if (currentPageContext.pageType == 'product_detail' && currentPageContext.product_id){
    context = {
      "currentPage": {
        "productId": currentPageContext.product_id + ''
      }
    }
  }

  let filterVariable;
  if (filter || options.filter) {
    const mergedFilter = {
      ...filter,
      ...options
    }
    filterVariable = {
      "type": {
          "id": "recoOptions"
      },
      "value": {"filter_string": JSON.stringify(mergedFilter)}
    }
  }
  const strategy = options.strategy || 'similarity';
  const count = options.count || 10;

  let q = '';
  if (options.includeImpressionId){
    q += 'includeImpressionId=true';
  }

  const variables = [
    {
        "type": {
            "id": "gs_recoStrategy"
        },
        "value": {
            "id": strategy
        }
    },
    {
        "type": {
            "id": "gs_recoCount"
        },
        "value": count + ''
    }
  ]
  if (filterVariable) {
    variables.push(filterVariable);
  }
  return await httpPost(`/recommendations/by-context?${q}`, {
    context: context,
    "variables": variables
  });
};

export const openImpression = async (impressionId) => {
  try {
    if (!impressionId || typeof impressionId !== 'string' || window.gsImpressionIds.includes(impressionId)) {
      return;
    }

    window.gsImpressionIds.push(impressionId);
    return await httpPatch(`/recommendations/impression/${impressionId}`, { status: 'opened' });
  } catch (error) {
    console.error('Error:', error);
    return;
  }
};