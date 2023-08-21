const key = 'gs-v-1';

export const getToken = () => {
    const item = localStorage.getItem(key);
    if (!item) {
      return {};
    }
    return JSON.parse(item);
  };

export const isTokenValid = () => {
  const item = localStorage.getItem(key);
  if (!item) {
    return false;
  }
  try{
    const itemObj = JSON.parse(item);
    const timestamp = new Date(itemObj.ts);
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);
    return timestamp > oneDayAgo;
  }catch(e){
    console.log(e)
    return false;
  }
};  
export const setSession = (data = {}) => {
    data.ts = new Date();
    localStorage.setItem(key, JSON.stringify(data));
    return data;
};

export const clearSession = () => {
  localStorage.removeItem(key);
};

  