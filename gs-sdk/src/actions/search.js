import { getUrlParameter, removeParamFromUrl } from '../utils/dom';
import { updateSearchResult } from '../api/index'

_searchAction = function () {
    const searchInteractionClicked = getUrlParameter('_gsSearchCTR');
    if (searchInteractionClicked) {
        updateSearchResult(searchInteractionClicked, {
            status: 'clicked'
        });
        removeParamFromUrl('_gsSearchCTR');
    }
};

export const executeActions = (provider) => {
    _searchAction();
}