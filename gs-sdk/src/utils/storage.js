const key = 'gs-v-1';

export const getToken = () => {
    const item = localStorage.getItem(key);
    if (!item) {
      return {};
    }
    return JSON.parse(item);
  };
  
export const setSession = (data = {}) => {
    localStorage.setItem(key, JSON.stringify(data));
    return data;
};
  