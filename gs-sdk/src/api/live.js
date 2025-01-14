import { httpGet, httpPatch } from '../utils/http';


export const liveGetVideo = async (videoId) => {
    const url = `/addon/live/video?id=${videoId}`;
    const result = await httpGet(url);
    return result;
}

export const liveLikeVideo = async (videoId) => {
    const url = `/addon/live/video/${videoId}/like`;
    const result = await httpPatch(url, {});
    return result;
}

export const liveUnlikeVideo = async (videoId) => {
    const url = `/addon/live/video/${videoId}/unlike`;
    const result = await httpPatch(url, {});
    return result;
}

export const liveTrackVideoTime = async (videoId, time) => {
    const url = `/addon/live/video/${videoId}/time`;
    const result = await httpPatch(url, { time });
    return result;
}

