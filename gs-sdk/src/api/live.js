import { httpGet, httpPatch } from '../utils/http';


export const liveGetVideo = async (videoId) => {
    const url = `/addons/live/video?id=${videoId}`;
    const result = await httpGet(url);
    return result;
}

export const liveLikeVideo = async (videoId) => {
    const url = `/addons/live/video/${videoId}/like`;
    const result = await httpPatch(url, {});
    return result;
}

export const liveUnlikeVideo = async (videoId) => {
    const url = `/addons/live/video/${videoId}/unlike`;
    const result = await httpPatch(url, {});
    return result;
}