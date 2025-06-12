import { httpPost} from './http'

export const sendEvent = async (key, value, customer) => {
    await httpPost(`/personal/content-event`, { key, value });
};
