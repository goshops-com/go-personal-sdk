
import { httpGet, httpPost } from '../utils/http';

export const bestProducts = async (options = {}) => {
  return await httpGet(`/recommendations/best-products`);
};

export const byContext = async (options = {}) => {
  let context = options.context;
  const currentPageContext = window.gsConfig.options.context || {};
  if (currentPageContext.pageType == 'product_detail' && currentPageContext.product_id){
    context = {
      "currentPage": {
        "productId": "21697"
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