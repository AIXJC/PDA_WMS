import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
} else {
  dotenv.config();
}

const REQUEST_TIMEOUT_MS = Number(process.env.ERP_REQUEST_TIMEOUT_MS || 10000);

// Endpoints de mes_integration.api.mes.stock_entry.* : cuerpo JSON, códigos HTTP
// estándar (200/400/404/409/500) para indicar éxito/error.
async function callErpJson(url, method, body) {
  if (!url) {
    return { ok: false, status: 0, data: null, message: "Endpoint del ERP no configurado (revisa server/.env)." };
  }

  const token = process.env.ERP_API_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON response body; keep data as null.
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        message: data?.message || data?.exception || `El ERP respondió ${response.status}`,
      };
    }

    return { ok: true, status: response.status, data, message: data?.message || "OK" };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Tiempo de espera agotado al contactar al ERP."
      : `No se pudo contactar al ERP: ${error.message}`;
    return { ok: false, status: 0, data: null, message };
  } finally {
    clearTimeout(timeout);
  }
}

// Endpoints de mes_integration.api.warehouse_map.storage_locations.* : cuerpo
// application/x-www-form-urlencoded, y SIEMPRE responden HTTP 200 (incluso en
// error) — el resultado real viene envuelto en el campo "message" de Frappe:
// { "message": { "status": "success"|"error", "action", "message", "data" } }
async function callErpForm(url, method, fields) {
  if (!url) {
    return { ok: false, status: 0, data: null, message: "Endpoint del ERP no configurado (revisa server/.env)." };
  }

  const token = process.env.ERP_API_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
      body: params.toString(),
      signal: controller.signal,
    });

    let raw = null;
    try {
      raw = await response.json();
    } catch {
      // Non-JSON response body; keep raw as null.
    }

    const payload = raw?.message && typeof raw.message === "object" ? raw.message : raw;
    const isSuccess = response.ok && payload?.status === "success";

    if (!isSuccess) {
      return {
        ok: false,
        status: response.status,
        data: payload,
        message: payload?.message || `El ERP respondió ${response.status}`,
      };
    }

    return { ok: true, status: response.status, data: payload, message: payload?.message || "OK" };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Tiempo de espera agotado al contactar al ERP."
      : `No se pudo contactar al ERP: ${error.message}`;
    return { ok: false, status: 0, data: null, message };
  } finally {
    clearTimeout(timeout);
  }
}

export function createStockEntry(requestId) {
  return callErpJson(process.env.ERP_CREATE_STOCK_ENTRY_URL, "POST", { request_id: requestId });
}

export function updateStockEntry(requestId) {
  return callErpJson(process.env.ERP_UPDATE_STOCK_ENTRY_URL, "PUT", { request_id: requestId });
}

export function submitStockEntry({ requestId, quantity, batchNo }) {
  const body = { request_id: requestId, quantity };
  if (batchNo) body.batch_no = batchNo;
  return callErpJson(process.env.ERP_SUBMIT_STOCK_ENTRY_URL, "PUT", body);
}

export function storeMaterialInRack({ storageId, partNumber, quantity, batch }) {
  return callErpForm(process.env.ERP_STORE_MATERIAL_IN_RACK_URL, "POST", {
    mes_storage_id: storageId,
    part_number: partNumber,
    quantity,
    batch,
  });
}
