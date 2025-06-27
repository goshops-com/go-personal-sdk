import { httpPost} from './http'

export const sendEvent = async (targetId, variantId, customer) => {
    // await httpPost(`/personal/content-event`, { key: targetId, value: variantId });

    await httpPost(`https://custom-events.gopersonal.ai/event`, { key: targetId, value: variantId, customer: customer });
    //https://custom-events.gopersonal.ai/event
};
