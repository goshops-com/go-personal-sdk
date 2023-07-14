import { useEffect, useState } from 'react';
import GSSDK from '@goshops/gs-sdk'; // import your SDK

function useGSSDK(clientId) {
  const [sdk, setSdk] = useState(null);

  useEffect(() => {
    const gsSDK = new GSSDK(clientId);
    setSdk(gsSDK);
  }, [clientId]);

  return sdk;
}

export default useGSSDK;
