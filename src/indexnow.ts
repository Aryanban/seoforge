export interface IndexNowOptions {
  host: string;
  key: string;
  keyLocation?: string;
  urlList: string[];
}

export interface IndexNowResponse {
  success: boolean;
  status: number;
  message: string;
  submittedCount: number;
}

export async function submitToIndexNow(options: IndexNowOptions): Promise<IndexNowResponse> {
  const { host, key, keyLocation, urlList } = options;

  if (!host || !key || urlList.length === 0) {
    return {
      success: false,
      status: 400,
      message: "Missing host, API key, or empty urlList.",
      submittedCount: 0,
    };
  }

  const payload: any = {
    host,
    key,
    urlList,
  };

  if (keyLocation) {
    payload.keyLocation = keyLocation;
  }

  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "SEOForge-IndexNow/1.0 (+https://github.com/Aryanban/seoforge)",
      },
      body: JSON.stringify(payload),
    });

    // 200: OK, 202: Accepted (IndexNow returns 200 or 202 on success)
    if (res.status === 200 || res.status === 202) {
      return {
        success: true,
        status: res.status,
        message: `Successfully submitted ${urlList.length} URL(s) to IndexNow network (Bing/Yandex).`,
        submittedCount: urlList.length,
      };
    } else {
      const errorText = await res.text();
      return {
        success: false,
        status: res.status,
        message: `IndexNow returned status ${res.status}: ${errorText || res.statusText}`,
        submittedCount: 0,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      status: 0,
      message: `Network failure connecting to api.indexnow.org: ${err.message}`,
      submittedCount: 0,
    };
  }
}
