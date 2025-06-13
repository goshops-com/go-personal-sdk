import { httpPost} from './http'

export const sendEvent = async (targetId, variantId, customer) => {
    await httpPost(`/personal/content-event`, { key: targetId, value: variantId });
};
