const FENICIO_CARDS_ENDPOINT = '/catalogo/cargar-variantes';
const FENICIO_RESPONSE_TYPES = ['html', 'parsed'];

const normalizeCodes = (codes) => {
    const input = Array.isArray(codes) ? codes : [codes];
    return [...new Set(input
        .filter(code => code !== undefined && code !== null)
        .map(code => String(code).trim())
        .filter(Boolean))];
};

const addQueryParams = (searchParams, params) => {
    if (!params) {
        return;
    }

    if (!(params instanceof URLSearchParams) && (typeof params !== 'object' || Array.isArray(params))) {
        throw new TypeError('getFenicioCards options.params must be an object or URLSearchParams');
    }

    const entries = params instanceof URLSearchParams
        ? Array.from(params.entries())
        : Object.entries(params);

    const replacedKeys = new Set();
    entries.forEach(([key, value]) => {
        if (key === 'c' || key === 'c[]' || value === undefined || value === null) {
            return;
        }

        if (!replacedKeys.has(key)) {
            searchParams.delete(key);
            replacedKeys.add(key);
        }

        const values = Array.isArray(value) ? value : [value];
        values.forEach(item => {
            if (item !== undefined && item !== null) {
                searchParams.append(key, String(item));
            }
        });
    });
};

const buildRequestUrl = (codes, params) => {
    const searchParams = new URLSearchParams();
    codes.forEach(code => searchParams.append('c[]', code));
    searchParams.set('paginaCatalogo', '');
    addQueryParams(searchParams, params);
    return `${FENICIO_CARDS_ENDPOINT}?${searchParams.toString()}`;
};

const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();

const toAbsoluteUrl = (value) => {
    if (!value) {
        return null;
    }

    try {
        return new URL(value, window.location.href).href;
    } catch (error) {
        return value;
    }
};

const parseAmount = (value) => {
    const amount = cleanText(value).replace(/[^\d,.-]/g, '');
    if (!amount) {
        return null;
    }

    const lastComma = amount.lastIndexOf(',');
    const lastDot = amount.lastIndexOf('.');
    const separatorIndex = Math.max(lastComma, lastDot);
    const decimalLength = separatorIndex === -1 ? 0 : amount.length - separatorIndex - 1;
    const hasDecimal = decimalLength > 0 && decimalLength <= 2;
    const integerPart = hasDecimal ? amount.slice(0, separatorIndex) : amount;
    const decimalPart = hasDecimal ? amount.slice(separatorIndex + 1) : '';
    const normalized = `${integerPart.replace(/[.,]/g, '')}${decimalPart ? `.${decimalPart}` : ''}`;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
};

const getClasses = element => element ? Array.from(element.classList) : [];

const getImage = (element) => {
    const image = element?.querySelector('img');
    if (!image) {
        return null;
    }

    return {
        url: toAbsoluteUrl(image.getAttribute('src') || image.getAttribute('data-src')),
        alt: image.getAttribute('alt') || null,
    };
};

const getPercentage = (element) => {
    const integer = cleanText(element?.querySelector('.int')?.textContent);
    const decimal = cleanText(element?.querySelector('.dec')?.textContent);
    if (!integer) {
        return null;
    }

    const value = Number(`${integer}${decimal ? `.${decimal}` : ''}`);
    return Number.isFinite(value) ? value : null;
};

const getClassId = (classes, prefix) => {
    const className = classes.find(value => new RegExp(`^${prefix}\\d+$`).test(value));
    return className ? className.slice(prefix.length) : null;
};

const getBadgeKind = (classes) => {
    const fixedKind = ['nuevo', 'sale', 'outlet'].find(value => classes.includes(value));
    if (fixedKind) {
        return fixedKind;
    }
    if (classes.some(value => value === 'promo' || /^promo\d+$/.test(value))) {
        return 'promotion';
    }
    if (classes.some(value => value === 'grupo' || /^grupo\d+$/.test(value))) {
        return 'group';
    }
    if (classes.includes('porcRebaja')) {
        return 'discount';
    }
    return classes.find(value => !['ico', 'promo-data', 'fn-hidden'].includes(value)) || 'custom';
};

const parseBadge = (element, location) => {
    const classes = getClasses(element);
    const image = getImage(element);
    const slot = element.closest?.('.dfl, .ctm');
    const text = cleanText(element.textContent);
    const percentage = getPercentage(element);

    return {
        location,
        slot: slot ? getClasses(slot)[0] || null : null,
        kind: getBadgeKind(classes),
        label: image?.alt || (percentage !== null && /^[\d\s.,]+$/.test(text) ? null : text || null),
        image,
        percentage,
        promotionId: element.getAttribute('data-id') || getClassId(classes, 'promo'),
        groupId: getClassId(classes, 'grupo'),
        endsAt: element.getAttribute('data-fecha-fin') || null,
        classes,
    };
};

const parsePrice = (element, currency) => {
    const classes = getClasses(element);
    const amountText = cleanText(element.querySelector('.monto')?.textContent || element.textContent);
    const symbol = cleanText(element.querySelector('.sim')?.textContent) || currency?.sim || null;

    return {
        type: classes.includes('lista') ? 'list' : classes.includes('venta') ? 'current' : 'other',
        amount: parseAmount(amountText),
        amountText,
        formatted: cleanText(element.textContent),
        currency: {
            code: currency?.cod || null,
            symbol,
        },
        classes,
    };
};

const parsePaymentDiscount = (element, currency) => {
    const image = getImage(element);
    const labelElement = element.querySelector('.img');
    const priceElement = element.querySelector('.precio');

    return {
        id: getClassId(getClasses(element), 'desc_'),
        label: image?.alt || labelElement?.getAttribute('title') || cleanText(element.textContent) || null,
        image,
        price: priceElement ? parsePrice(priceElement, currency) : null,
        classes: getClasses(element),
    };
};

const parseNativeData = (card) => {
    const jsonElement = card.querySelector('input.json');
    if (!jsonElement?.value) {
        return null;
    }

    try {
        return JSON.parse(jsonElement.value);
    } catch (error) {
        return null;
    }
};

const parseCard = (card) => {
    const data = parseNativeData(card);
    const currency = data?.moneda || null;
    const imageBadges = Array.from(card.querySelectorAll('.cocardas .ico, .cocardas .promo-data'))
        .map(element => parseBadge(element, 'image'));
    const discountBadges = Array.from(card.querySelectorAll('.porcRebaja'))
        .map(element => parseBadge(element, 'image'));
    const lowerBadges = Array.from(card.querySelectorAll('.cocardasTexto > *'))
        .map(element => parseBadge(element, 'below-image'));

    return {
        code: card.getAttribute('data-codprod') || data?.producto?.codigo || null,
        variantCode: card.getAttribute('data-codvar') || data?.variante?.codigo || null,
        available: card.hasAttribute('data-disp') ? card.getAttribute('data-disp') === '1' : null,
        data,
        prices: Array.from(card.querySelectorAll('.precios .precio'))
            .map(element => parsePrice(element, currency)),
        badges: [...imageBadges, ...discountBadges, ...lowerBadges],
        paymentDiscounts: Array.from(card.querySelectorAll('.descuentosMDP > *'))
            .map(element => parsePaymentDiscount(element, currency)),
    };
};

export const parseFenicioCards = (html, requestedCodes = []) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const groupsByCode = new Map();

    document.querySelectorAll('[data-codigo]').forEach((group) => {
        const code = group.getAttribute('data-codigo');
        if (!code) {
            return;
        }

        const cards = Array.from(group.querySelectorAll('.it')).map(parseCard);
        const current = groupsByCode.get(code) || { code, cards: [] };
        current.cards.push(...cards);
        groupsByCode.set(code, current);
    });

    const codes = normalizeCodes(requestedCodes);
    return codes.length
        ? codes.map(code => groupsByCode.get(code) || { code, cards: [] })
        : Array.from(groupsByCode.values());
};

/**
 * Fetches native Fenicio cards from the current storefront.
 * responseType "html" returns the endpoint response unchanged.
 * responseType "parsed" returns groups with card data, prices, badges and payment discounts.
 */
export const getFenicioCards = async (codes, options = {}) => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('getFenicioCards options must be an object');
    }

    const requestedCodes = normalizeCodes(codes);
    if (!requestedCodes.length) {
        throw new TypeError('getFenicioCards requires at least one product code');
    }

    const responseType = options.responseType || 'html';
    if (!FENICIO_RESPONSE_TYPES.includes(responseType)) {
        throw new TypeError('getFenicioCards responseType must be "html" or "parsed"');
    }

    const url = buildRequestUrl(requestedCodes, options.params);
    const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!response.ok) {
        const error = new Error(`Fenicio cards request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
    }

    const html = await response.text();
    return responseType === 'parsed' ? parseFenicioCards(html, requestedCodes) : html;
};
