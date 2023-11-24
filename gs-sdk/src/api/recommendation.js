
import { httpGet, httpPost } from '../utils/http';

export const bestProducts = async (options = {}) => {
  return await httpGet(`/recommendations/best-products`);
};