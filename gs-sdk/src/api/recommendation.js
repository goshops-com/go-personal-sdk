
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
  const currentPageContext = window.gsConfig.options.context || {};
  if (currentPageContext.pageType == 'product_detail' && currentPageContext.product_id){
    context = {
      "currentPage": {
        "productId": currentPageContext.product_id + ''
      }
    }
  }
    
  const strategy = options.strategy || 'similarity';
  const count = options.count || 10;

  return await httpPost(`/recommendations/by-context`, {
    context: context,
    "variables": [
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
  });
};

export const openImpression = async (impressionId) => {
  return await httpPatch(`/recommendations/impression/${impressionId}`, {status: 'opened'});
};