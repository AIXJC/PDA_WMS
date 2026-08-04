import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Check,
  Scan,
  ChevronRight,
  Package,
  User,
  Calendar,
  LoaderCircle,
  X,
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';

interface OrderItem {
  id: string;
  sku: string;
  name: string;
  expected: number;
  scanned: number;
  status: 'pending' | 'partial' | 'completed';
}

interface InboundOrderDetail {
  PurchaseOrderDetailID: number;
  PurchaseOrderID: number;
  ItemID: number;
  Qty: number;
  ReceivedQty: number;
  PartNumber: string;
  PartName: string;
  WorkArea: string;
  PartType: string;
  MeasureType: string;
  MeasureDescription: string;
}

interface InboundOrderSummary {
  RequestID?: number;
  PurchaseOrderID: number;
  PONumber: string;
  ProviderID: number;
  ProviderName: string;
  OrderDate: string;
  ExpectedDate: string;
  OrderStatusID: number;
  StatusType: string;
  StatusDescription: string;
  itemCount: number;
  orderedQty: number;
  receivedQty: number;
  LotReceiveID?: number | null;
  LotInventoryID?: number | null;
  CurrentLocationID?: number | null;
  ProviderLot?: string | null;
  InternalLot?: string | null;
  ShortInternalLot?: string | null;
  CreateDate: string;
  UpdateDate: string;
}

const MOCK_ORDERS = {
  inbound: [
    { id: 'REC-9021', provider: 'Industrial Tools SA', date: '2024-05-18', items: 12, status: 'pending' },
    { id: 'REC-9022', provider: 'Global Logistics', date: '2024-05-18', items: 5, status: 'partial' },
  ],
  outbound: [
    { id: 'PICK-4412', client: 'Taller Central', date: '2024-05-18', items: 8, status: 'pending' },
    { id: 'PICK-4413', client: 'Suministros Norte', date: '2024-05-18', items: 24, status: 'completed' },
  ],
};

const MOCK_ORDER_ITEMS: OrderItem[] = [
  { id: '1', sku: 'PROD-001', name: 'Caja de Herramientas Industrial', expected: 10, scanned: 0, status: 'pending' },
  { id: '2', sku: 'PROD-002', name: 'Guantes de Protección Nitrilo', expected: 50, scanned: 50, status: 'completed' },
  { id: '3', sku: 'PROD-003', name: 'Casco de Seguridad V-Gard', expected: 5, scanned: 2, status: 'partial' },
];

export const Orders: React.FC = () => {
  const { type, detailId } = useParams<{ type: 'inbound' | 'outbound'; detailId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [inboundView, setInboundView] = useState<'history' | 'detail'>('history');
  const [items] = useState<OrderItem[]>(MOCK_ORDER_ITEMS);
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const PAGE_SIZE = 10;
  const [inboundOffset, setInboundOffset] = useState(0);
  const [inboundHasMore, setInboundHasMore] = useState(true);
  const [outboundOffset, setOutboundOffset] = useState(0);
  const [outboundHasMore, setOutboundHasMore] = useState(true);
  const [error, setError] = useState('');
  const [selectedInboundOrder, setSelectedInboundOrder] = useState<InboundOrderSummary | null>(null);
  const [selectedInboundDetails, setSelectedInboundDetails] = useState<InboundOrderDetail[]>([]);
  const [inboundDetailModalOpen, setInboundDetailModalOpen] = useState(false);
  const [selectedInboundReceipts, setSelectedInboundReceipts] = useState<any[]>([]);
  const [lotInput, setLotInput] = useState('');
  const [selectedLot, setSelectedLot] = useState<any | null>(null);
  const [selectedLotDetails, setSelectedLotDetails] = useState<any | null>(null);
  const [showLotDetailsModal, setShowLotDetailsModal] = useState(false);
  const [lotLookupLoading, setLotLookupLoading] = useState(false);
  const [lotMode, setLotMode] = useState(true);
  const [availableLots, setAvailableLots] = useState<any[]>([]);
  const [availableLotsLoading, setAvailableLotsLoading] = useState(false);
  const [selectedOutboundOrder, setSelectedOutboundOrder] = useState<any | null>(null);
  const [selectedOutboundDetails, setSelectedOutboundDetails] = useState<any[]>([]);
  const [selectedOutboundLogs, setSelectedOutboundLogs] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeReceiveLineId, setActiveReceiveLineId] = useState<number | null>(null);
  const [scannedCounts, setScannedCounts] = useState<Record<number, number>>({});
  const [historyFilter, setHistoryFilter] = useState<'all' | 'completed' | 'in-progress' | 'pending'>('all');
  const [showQuarantineModal, setShowQuarantineModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [storageLocations, setStorageLocations] = useState<any[]>([]);
  const [loadingStorageLocations, setLoadingStorageLocations] = useState(false);
  const [selectedStorageLocation, setSelectedStorageLocation] = useState<any | null>(null);
  const [rackCodeInput, setRackCodeInput] = useState('');
  const [sourceLocations, setSourceLocations] = useState<Array<{LocationID:number; LocationName:string}>>([]);
  const [destinationLocations, setDestinationLocations] = useState<Array<{LocationID:number; LocationName:string}>>([]);
  const [providerFilter, setProviderFilter] = useState('');
  const [poFilter, setPoFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [inboundTab, setInboundTab] = useState<'approved' | 'pending'>('pending');
  const [statusOptions, setStatusOptions] = useState<Array<any>>([]);
  const [outboundStatusOptions, setOutboundStatusOptions] = useState<string[]>([]);
  const requestedStatus = useMemo(() => new URLSearchParams(location.search).get('status') || '', [location.search]);
  const [selectedStatusId, setSelectedStatusId] = useState<string>('');
  const { user } = useAuthStore();

  const filteredAvailableLots = useMemo(() => {
    const query = lotInput.trim().toLowerCase();
    if (!query) return availableLots;
    return availableLots.filter((lot: any) => {
      const values = [lot.ProviderLot, lot.InternalLot, lot.ShortInternalLot, lot.ReceiveID?.toString(), lot.LotReceiveID?.toString(), lot.PONumber]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return values.some((value) => value.includes(query));
    });
  }, [availableLots, lotInput]);

  const getInboundOrderStatus = (order: any) => {
    const ordered = Number(order?.orderedQty ?? 0);
    const received = Number(order?.receivedQty ?? 0);
    if (ordered > 0 && received >= ordered) return 'completed';
    if (ordered > 0 && received > 0 && received < ordered) return 'follow-up';
    if (received > 0) return 'in-progress';
    return 'pending';
  };

  
  const isInboundPending = (order: any) => {
    const statusId = Number(order?.OrderStatusID ?? order?.RequestStatusID ?? 0);
    if (statusId === 41) return true; // pendiente
    if (statusId === 42) return false; // aprobada/ejecutada

    const statusText = String(order?.StatusDescription || order?.StatusCode || '').toLowerCase();
    return statusText.includes('pendiente') || statusText.includes('pending') || statusText.includes('draft');
  };

  const inboundPendingOrders = orders.filter((order) => Number(order?.OrderStatusID ?? order?.RequestStatusID ?? 0) === 41);
  const inboundApprovedOrders = orders.filter((order) => Number(order?.OrderStatusID ?? order?.RequestStatusID ?? 0) === 42);

  const isOutbound = type === 'outbound';
  const title = isOutbound ? 'Órdenes de Salida' : 'Órdenes de Entrada';

  // No auto-fallback from approved to pending; the user should remain in the selected tab
  // so they can see that there are no status 42 orders if none are available.
  useEffect(() => {
    if (isOutbound) return;
  }, [isOutbound]);

  useEffect(() => {
    // initial load or reload when filters/tab change
    void loadInboundOrders(true);
  }, [isOutbound, providerFilter, poFilter, dateFilter, statusFilter, inboundTab]);
  const searchParams = new URLSearchParams(location.search);
  const requestedView = searchParams.get('view');
  const requestedPo = searchParams.get('po');
  const isInboundDetailRoute = !isOutbound && (
    Boolean(detailId)
    || location.pathname.includes('/detail')
    || requestedView === 'detail'
    || Boolean(requestedPo)
  );
  const isInboundDetailView = !isOutbound && (inboundView === 'detail' || isInboundDetailRoute);

  useEffect(() => {
    if (isOutbound) {
      setStatusFilter('');
    }
  }, [isOutbound]);

  useEffect(() => {
    if (isOutbound) return;

    const normalizedStatus = String(requestedStatus || '').trim().toLowerCase();
    if (normalizedStatus.includes('approv') || normalizedStatus === '41' || normalizedStatus === 'approved') {
      setInboundTab('approved');
    } else if (normalizedStatus.includes('pend') || normalizedStatus === '40' || normalizedStatus === 'pending') {
      setInboundTab('pending');
    }

    if (isInboundDetailRoute) {
      setInboundView('detail');
      setInboundDetailModalOpen(true);
      const purchaseOrderId = Number(detailId || requestedPo);
      if (Number.isFinite(purchaseOrderId) && purchaseOrderId > 0 && selectedInboundOrder?.PurchaseOrderID !== purchaseOrderId) {
        void loadInboundOrderDetails(purchaseOrderId, null, { resetLot: true });
      }
    } else {
      setInboundView('history');
      setInboundDetailModalOpen(false);
    }
  }, [isOutbound, isInboundDetailRoute, detailId, requestedPo, location.search, requestedStatus]);

  useEffect(() => {
    if (isOutbound || !selectedInboundOrder) return;

    const loadDestinationLocations = async () => {
      const options = await loadLocationOptions();
      if (!options) return;
      const nextSourceLocations = options.sourceLocations;
      const nextDestinationLocations = options.destinationLocations;
      if (!sourceLocationId && nextSourceLocations[0]) {
        setSourceLocationId(String(nextSourceLocations[0].LocationID));
      }
    };

    void loadDestinationLocations();
  }, [isOutbound, selectedInboundOrder]);

  useEffect(() => {
    setSelectedOrder(null);
    setSelectedInboundOrder(null);
    setSelectedInboundDetails([]);
    setSelectedInboundReceipts([]);
    setSelectedOutboundOrder(null);
    setSelectedOutboundDetails([]);
    setSelectedOutboundLogs([]);
    setError('');
    setLotMode(!isOutbound);

    if (isOutbound) {
      void loadOutboundOrders(true);
      return;
    }

    // load MES_STATUS options for UI filters (async IIFE)
    (async () => {
      try {
        const cfg = await fetch('/api/settings/catalogs');
        if (cfg.ok) {
          const cfgData = await cfg.json();
          const allStatuses = Array.isArray(cfgData.statuses) ? cfgData.statuses : [];
          // statuses for ERP_PURCHASE_RECEIPT module
          const receiptStatuses = allStatuses.filter((s: any) => String(s.ModuleCode || '').toUpperCase() === 'ERP_PURCHASE_RECEIPT');
          // ensure IDs 8 and 10 are available (from work order modules) and include them
          const extra = allStatuses.filter((s: any) => [8, 10].includes(Number(s.StatusID)));
          const combined = [...receiptStatuses];
          for (const e of extra) {
            if (!combined.find((c) => Number(c.StatusID) === Number(e.StatusID))) combined.push(e);
          }
          setStatusOptions(combined);
        }
      } catch (e) {
        // ignore settings load errors
      }
    })();

    // loadInboundOrders will be called below (initial load)
    // (implementation is outside this effect so it can be reused for "Cargar más")
  }, [isOutbound, providerFilter, poFilter, dateFilter, statusFilter, inboundTab]);

  const loadInboundOrders = async (reset = false) => {
    if (isOutbound) return;
    try {
      if (reset) {
        setLoadingOrders(true);
      }

      const currentOffset = reset ? 0 : inboundOffset;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(currentOffset));
      const statusParam = statusFilter || requestedStatus;
      if (statusParam) {
        params.set('status', statusParam);
      }

      const response = await fetch(`/api/requests/inbound?${params.toString()}`);
      if (!response.ok) throw new Error('No fue posible cargar las entradas');
      const data = await response.json();
      const nextOrders = Array.isArray(data.orders) ? data.orders : [];
      if (reset) {
        setOrders(nextOrders);
      } else {
        setOrders((prev) => [...prev, ...nextOrders]);
      }
      setInboundHasMore(nextOrders.length === PAGE_SIZE);
      setInboundOffset((prev) => (reset ? nextOrders.length : prev + nextOrders.length));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando entradas');
    } finally {
      if (reset) setLoadingOrders(false);
    }
  };

  const loadOutboundOrders = async (reset = false) => {
    if (!isOutbound) return;
    try {
      if (reset) setLoadingOrders(true);

      const currentOffset = reset ? 0 : outboundOffset;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(currentOffset));
      if (statusFilter) params.set('status', statusFilter);

      const response = await fetch(`/api/orders/outbound?${params.toString()}`);
      if (!response.ok) throw new Error('No fue posible cargar las salidas');
      const data = await response.json();
      const nextOrders = Array.isArray(data.orders) ? data.orders : [];

      if (reset) {
        setOrders(nextOrders);
      } else {
        setOrders((prev) => [...prev, ...nextOrders]);
      }

      // collect status options on first load
      if (reset) {
        setOutboundStatusOptions(Array.from(new Set(nextOrders.map((order: any) => String(order.StatusDescription || order.StatusCode || 'Sin estado').trim()).filter(Boolean))));
      }

      setOutboundHasMore(nextOrders.length === PAGE_SIZE);
      setOutboundOffset((prev) => (reset ? nextOrders.length : prev + nextOrders.length));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando salidas');
      if (reset) {
        setOrders([]);
        setOutboundStatusOptions([]);
      }
    } finally {
      if (reset) setLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (isOutbound || !statusOptions.length || !requestedStatus) return;

    const normalized = requestedStatus.trim().toLowerCase();
    const matched = statusOptions.find((option: any) => {
      const description = String(option.StatusDescription || '').trim().toLowerCase();
      const code = String(option.StatusCode || '').trim().toLowerCase();
      return String(option.StatusID) === normalized || description === normalized || description.includes(normalized) || code === normalized || code.includes(normalized);
    });

    if (matched && statusFilter !== String(matched.StatusID)) {
      setStatusFilter(String(matched.StatusID));
    }
  }, [isOutbound, requestedStatus, statusOptions, statusFilter]);

  const loadInboundOrderDetails = async (purchaseOrderId: number, orderSummary?: Partial<InboundOrderSummary> | null, options?: { resetLot?: boolean }) => {
    const { resetLot = true } = options || {};
    const requestId = Number(purchaseOrderId);
    setSelectedOrder(String(requestId));
    setInboundView('detail');
    setSelectedInboundOrder(orderSummary ? ({ ...orderSummary, PurchaseOrderID: requestId } as InboundOrderSummary) : null);
    setSelectedInboundDetails([]);
    setSelectedInboundReceipts([]);
    if (resetLot) {
      setSelectedLot(null);
      setLotInput('');
    }
    setLotMode(false);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/requests/inbound/${requestId}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle de la entrada');
      const data = await response.json();
      const request = data.request || null;
      setSelectedInboundOrder({ ...(orderSummary || {}), PurchaseOrderID: requestId, ...(request || {}) } as InboundOrderSummary);
      setSelectedInboundDetails(request ? [{
        PurchaseOrderDetailID: request.RequestID,
        PurchaseOrderID: request.RequestID,
        ItemID: request.PartNumber,
        Qty: Number(request.Quantity || 0),
        ReceivedQty: 0,
        PartNumber: request.PartNumber,
        PartName: request.PartName || request.RequestName || 'Solicitud de entrada',
        WorkArea: '',
        PartType: '',
        MeasureType: '',
        MeasureDescription: 'pz',
      }] : []);
      setSelectedInboundReceipts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando detalle');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeInboundDetailView = () => {
    setInboundDetailModalOpen(false);
    navigate(`/orders/${type}`);
    setSelectedOrder(null);
    setSelectedInboundOrder(null);
    setSelectedInboundDetails([]);
    setSelectedInboundReceipts([]);
    setInboundView('history');
    setLotMode(true);
  };

  const handleSelectInboundOrder = async (order: InboundOrderSummary) => {
    const targetPath = `/orders/${type}/detail/${order.PurchaseOrderID}`;
    navigate(targetPath);
    setInboundView('detail');
    setInboundDetailModalOpen(true);
    await loadInboundOrderDetails(order.PurchaseOrderID, order, { resetLot: true });
  };

  const resolveLotPurchaseOrderId = (lot: any) => {
    const purchaseOrderId = Number(lot?.PurchaseOrderID);
    const fallbackPurchaseOrderId = Number(lot?.purchaseOrderId || lot?.purchaseOrderID);
    return Number.isInteger(purchaseOrderId) && purchaseOrderId > 0
      ? purchaseOrderId
      : (Number.isInteger(fallbackPurchaseOrderId) && fallbackPurchaseOrderId > 0 ? fallbackPurchaseOrderId : null);
  };

  const loadLocationOptions = async () => {
    try {
      const response = await fetch('/api/scrap/location-options');
      if (!response.ok) return null;
      const data = await response.json();
      const nextSourceLocations = Array.isArray(data.sourceLocations) ? data.sourceLocations : [];
      const nextDestinationLocations = Array.isArray(data.destinationLocations) ? data.destinationLocations : [];
      setSourceLocations(nextSourceLocations);
      setDestinationLocations(nextDestinationLocations);
      return { sourceLocations: nextSourceLocations, destinationLocations: nextDestinationLocations };
    } catch (error) {
      console.error('No se pudieron cargar las ubicaciones para el puente de entradas', error);
      return null;
    }
  };

  const isIncomingLot = (lot: any, resolvedSourceLocations?: Array<{ LocationID?: number; LocationName?: string }>) => {
    const currentLocationId = Number(lot?.CurrentLocationID ?? 0);
    const currentLocationName = String(lot?.CurrentLocationName || lot?.LocationName || '').trim().toLowerCase();
    const candidates = resolvedSourceLocations ?? sourceLocations;

    if (!currentLocationId && !currentLocationName) return false;

    const matched = candidates.some((location) => {
      const locationId = Number(location?.LocationID ?? 0);
      const locationName = String(location?.LocationName || '').trim().toLowerCase();
      return ((locationId > 0 && currentLocationId > 0 && locationId === currentLocationId) || (locationName && currentLocationName && locationName === currentLocationName))
        && /(incoming|receiving|entrada|recepcion)/i.test(locationName);
    });

    return matched;
  };

  const handleSelectLot = async (lot: any) => {
    setSelectedLot(lot);
    setSelectedLotDetails(lot);
    setError('');
    setLotInput(String(lot?.ProviderLot || lot?.InternalLot || lot?.ShortInternalLot || lot?.ReceiveID || lot?.LotReceiveID || ''));

    const resolvedLocations = sourceLocations.length > 0 ? sourceLocations : await loadLocationOptions();
    const resolvedSourceLocations = resolvedLocations && 'sourceLocations' in resolvedLocations
      ? resolvedLocations.sourceLocations
      : undefined;
    if (isIncomingLot(lot, resolvedSourceLocations)) {
      const params = new URLSearchParams({
        from: 'inbound',
        lotInventoryId: String(lot?.LotInventoryID ?? lot?.LotInventoryId ?? ''),
        lotReference: String(lot?.InternalLot || lot?.ShortInternalLot || lot?.ProviderLot || lot?.LotReceiveID || lot?.ReceiveID || ''),
      });
      navigate(`/requests?${params.toString()}`);
      return;
    }

    const resolvedPurchaseOrderId = resolveLotPurchaseOrderId(lot);
    if (resolvedPurchaseOrderId) {
      setLotMode(false);
      await loadInboundOrderDetails(resolvedPurchaseOrderId, {
        PurchaseOrderID: resolvedPurchaseOrderId,
        PONumber: lot?.PONumber || undefined,
      }, { resetLot: false });
      return;
    }

    setLotMode(false);
  };

  const openLotDetails = (lot: any) => {
    setSelectedLotDetails(lot);
    setShowLotDetailsModal(true);
  };

  const loadAvailableLots = async () => {
    if (isOutbound) return;
    setAvailableLotsLoading(true);
    try {
      const response = await fetch('/api/requests/lots?limit=20');
      if (!response.ok) throw new Error('No fue posible cargar los lotes disponibles');
      const data = await response.json();
      setAvailableLots(Array.isArray(data.lots) ? data.lots : []);
    } catch (err) {
      setAvailableLots([]);
      setError(err instanceof Error ? err.message : 'No fue posible cargar los lotes disponibles');
    } finally {
      setAvailableLotsLoading(false);
    }
  };

  useEffect(() => {
    if (lotMode && !isOutbound) {
      void loadAvailableLots();
    }
  }, [lotMode, isOutbound]);

  const handleLotLookup = async () => {
    if (!lotInput.trim()) {
      setError('Escanea o escribe un lote antes de continuar.');
      return;
    }

    setLotLookupLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/requests/lots?lotReference=${encodeURIComponent(lotInput.trim())}`);
      if (!response.ok) throw new Error('No fue posible consultar el lote');
      const data = await response.json();
      const matches = Array.isArray(data.lots) ? data.lots : [];
      const normalized = lotInput.trim().toLowerCase();
      const found = matches.find((lot: any) => {
        const values = [lot.ProviderLot, lot.InternalLot, lot.ShortInternalLot, lot.ReceiveID?.toString(), lot.LotReceiveID?.toString()].filter(Boolean).map((val) => String(val).toLowerCase());
        return values.includes(normalized);
      }) || matches[0] || null;

      if (!found) {
        setSelectedLot(null);
        setError('No se encontró un lote con esa referencia.');
        return;
      }

      await handleSelectLot(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible consultar el lote');
    } finally {
      setLotLookupLoading(false);
    }
  };

  const handleSelectOutboundOrder = async (order: any) => {
    setSelectedOrder(String(order.ShipmentID));
    setSelectedOutboundOrder(order);
    setSelectedOutboundDetails([]);
    setSelectedOutboundLogs([]);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/orders/outbound/${order.ShipmentID}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle de la salida');
      const data = await response.json();
      setSelectedOutboundOrder({ ...order, ...(data.order || {}) });
      setSelectedOutboundDetails(Array.isArray(data.details) ? data.details : []);
      setSelectedOutboundLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando detalle');
    } finally {
      setDetailLoading(false);
    }
  };

  const selectedInboundStatusId = selectedInboundOrder
    ? Number((selectedInboundOrder as any).RequestStatusID ?? selectedInboundOrder.OrderStatusID ?? 0)
    : null;
  const isReadonlyInboundOrder = selectedInboundStatusId === 40 || selectedInboundStatusId === 41 || selectedInboundStatusId === 42;

  const inboundSummary = useMemo(() => {
    if (isOutbound || !selectedInboundOrder) return null;

    const totalExpected = selectedInboundDetails.reduce((sum, item) => sum + Number(item.Qty || 0), 0);
    const totalReceived = selectedInboundDetails.reduce((sum, item) => sum + Number(item.ReceivedQty || 0), 0);
    const completedCount = selectedInboundDetails.filter((item) => Number(item.ReceivedQty || 0) >= Number(item.Qty || 0)).length;

    return {
      totalExpected,
      totalReceived,
      completedCount,
      progress: totalExpected > 0 ? Math.round((totalReceived / totalExpected) * 100) : 0,
    };
  }, [isOutbound, selectedInboundOrder, selectedInboundDetails]);

  const totalScannedPieces = useMemo(() => {
    return selectedInboundDetails.reduce((sum, item) => {
      const count = scannedCounts[item.PurchaseOrderDetailID] || 0;
      return sum + count;
    }, 0);
  }, [selectedInboundDetails, scannedCounts]);

  const totalRemainingToScanPieces = useMemo(() => {
    return selectedInboundDetails.reduce((sum, item) => {
      const expected = Number(item.Qty || 0);
      const received = Number(item.ReceivedQty || 0);
      const scanned = scannedCounts[item.PurchaseOrderDetailID] || 0;
      return sum + Math.max(0, expected - received - scanned);
    }, 0);
  }, [selectedInboundDetails, scannedCounts]);

  const getStorageLocationCode = (location: any) => {
    const rackName = String(location?.RackName || '').trim().toUpperCase();
    const rackColumn = String(location?.RackColumn ?? 0);
    const rackCell = String(location?.RackCell ?? 0);
    return `${rackName}-${rackColumn}-${rackCell}`;
  };

  const loadStorageLocations = async () => {
    setLoadingStorageLocations(true);
    try {
      const response = await fetch('/api/storage-locations?limit=500');
      if (!response.ok) throw new Error('No fue posible cargar las ubicaciones de rack');
      const data = await response.json();
      const nextLocations = Array.isArray(data.locations) ? data.locations : [];
      setStorageLocations(nextLocations);

      if (nextLocations.length > 0) {
        const preferred = nextLocations.find((loc: any) => {
          const currentLocationId = Number(selectedLot?.CurrentLocationID || 0);
          return currentLocationId > 0 && (Number(loc.LocationID) === currentLocationId || Number(loc.StorageID) === currentLocationId);
        }) || nextLocations[0];
        setSelectedStorageLocation(preferred);
        setDestinationLocationId(String(preferred.StorageID ?? preferred.LocationID ?? ''));
        setRackCodeInput(getStorageLocationCode(preferred));
      }
    } catch (err) {
      setStorageLocations([]);
      setError(err instanceof Error ? err.message : 'Error cargando ubicaciones de rack');
    } finally {
      setLoadingStorageLocations(false);
    }
  };

  const handleScanPiece = (item: InboundOrderDetail) => {
    const detailId = item.PurchaseOrderDetailID;
    const current = scannedCounts[detailId] || 0;
    const remaining = Math.max(0, Number(item.Qty || 0) - Number(item.ReceivedQty || 0) - current);
    if (remaining <= 0) return;

    setScannedCounts((prev) => ({
      ...prev,
      [detailId]: current + 1,
    }));
    setError('');
  };

  const handleOpenQuarantineModal = () => {
    if (totalScannedPieces <= 0) {
      setError('Debe escanear al menos una pieza antes de finalizar la recepción.');
      return;
    }

    setShowQuarantineModal(true);
    setError('');
    setRackCodeInput('');
    void loadStorageLocations();
    if (!sourceLocationId && selectedLot?.CurrentLocationID) {
      setSourceLocationId(String(selectedLot.CurrentLocationID));
    }
  };

  const handleRackCodeChange = (value: string) => {
    setRackCodeInput(value.toUpperCase());

    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setSelectedStorageLocation(null);
      setDestinationLocationId('');
      return;
    }

    const matchedLocation = storageLocations.find((loc: any) => getStorageLocationCode(loc) === normalized);
    if (matchedLocation) {
      setSelectedStorageLocation(matchedLocation);
      setDestinationLocationId(String(matchedLocation.StorageID ?? matchedLocation.LocationID ?? ''));
    }
  };

  const handleConfirmOrder = async () => {
    if (!selectedInboundOrder) return;
    if (!selectedInboundDetails.length) return;

    const scannedDetails = selectedInboundDetails
      .map((item) => ({
        purchaseOrderDetailID: item.PurchaseOrderDetailID,
        scannedQty: scannedCounts[item.PurchaseOrderDetailID] || 0,
        expectedQty: Number(item.Qty || 0),
        currentReceivedQty: Number(item.ReceivedQty || 0),
      }))
      .filter((item) => item.scannedQty > 0);

    if (scannedDetails.length === 0) {
      setError('Debe escanear al menos una pieza antes de confirmar la orden.');
      return;
    }

    const totalScanned = scannedDetails.reduce((sum, item) => sum + item.scannedQty, 0);

    if (!selectedStorageLocation) {
      setError('Debe seleccionar o escribir un rack válido que exista en el catálogo de ubicaciones.');
      return;
    }

    setError('');
    setConfirming(true);
    try {
      const requestId = Number(selectedInboundOrder?.RequestID ?? selectedInboundOrder?.PurchaseOrderID ?? 0);
      const response = await fetch(`/api/requests/inbound/${requestId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scannedDetails,
          receivedBy: user?.id ? Number(user.id) : undefined,
          storageId: selectedStorageLocation?.StorageID ? Number(selectedStorageLocation.StorageID) : undefined,
          quantity: totalScanned,
          lotReference: selectedLot?.InternalLot || selectedLot?.ShortInternalLot || selectedLot?.ProviderLot || selectedLot?.LotReceiveID || selectedLot?.ReceiveID || null,
          lotInventoryId: selectedLot?.LotInventoryID ?? selectedLot?.LotInventoryId ?? selectedLot?.id ?? null,
          sourceLocationId: sourceLocationId ? Number(sourceLocationId) : (selectedLot?.CurrentLocationID ? Number(selectedLot.CurrentLocationID) : undefined),
          requestUserId: user?.id ? Number(user.id) : undefined,
          comments: `Recepción confirmada desde ${selectedInboundOrder?.PONumber || 'PO'}`,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'No fue posible confirmar la orden');
      }

      setOrders((prev) => prev.map((order) => order.PurchaseOrderID === selectedInboundOrder.PurchaseOrderID
        ? { ...order, StatusDescription: data.statusName, receivedQty: data.receivedQty ?? order.receivedQty }
        : order
      ));
      setSelectedOrder(null);
      setSelectedInboundOrder(null);
      setSelectedInboundDetails([]);
      setSelectedInboundReceipts([]);
      setScannedCounts({});
      setShowQuarantineModal(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible confirmar la orden');
    } finally {
      setConfirming(false);
    }
  };

  if (selectedOrder && isOutbound) {
    return (
      <Layout title={`Salida - ${selectedOutboundOrder?.ShipmentNumber || selectedOrder}`}>
        <div className="space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
              {error}
            </div>
          )}

          <div className="rounded-[2.5rem] bg-slate-900 p-6 text-white shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-400">Cliente</p>
                <h2 className="text-xl font-black">{selectedOutboundOrder?.CustomerID || 'Sin cliente'}</h2>
              </div>
              <div className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold">
                {selectedOutboundDetails.length} líneas
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-[10px] font-bold text-slate-400">
              <div className="flex items-center gap-2">
                <Calendar size={14} />
                <span>{selectedOutboundOrder?.ShipmentDate ? new Date(selectedOutboundOrder.ShipmentDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha'}</span>
              </div>
              <div className="flex items-center gap-2">
                <User size={14} />
                <span>{selectedOutboundOrder?.ShipmentNumber || 'Sin número'}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estado</p>
              <p className="mt-2 text-sm font-black text-slate-900">{selectedOutboundOrder?.StatusDescription || selectedOutboundOrder?.StatusCode || 'Sin estado'}</p>
            </div>
            <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pedido</p>
              <p className="mt-2 text-sm font-black text-slate-900">{selectedOutboundOrder?.OrderQty ?? 0} unidades</p>
            </div>
            <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enviado</p>
              <p className="mt-2 text-sm font-black text-slate-900">{selectedOutboundOrder?.ShippedQty ?? 0} unidades</p>
            </div>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <LoaderCircle className="mr-2 animate-spin" size={18} />
              Cargando detalle...
            </div>
          ) : (
            <div className="space-y-3">
              {selectedOutboundDetails.map((item, index) => (
                <motion.div
                  key={item.ShipmentDetailID || index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-tighter text-slate-400">{item.PartNumber || item.ItemID}</p>
                      <h3 className="text-sm font-black text-slate-900">{item.PartName || 'Sin descripción'}</h3>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">Ubicación: {item.LocationName || 'Sin ubicación'}</p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 px-3 py-2 text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Solicitado</p>
                      <p className="text-sm font-black text-slate-900">{item.OrderQty ?? 0}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                    <span>Enviado: {item.ShippedQty ?? 0}</span>
                    <span>Work area: {item.WorkArea || 'Sin área'}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {selectedOutboundLogs.length > 0 && (
            <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm">
              <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Bitácora de envío</p>
              <div className="space-y-2 text-sm text-slate-600">
                {selectedOutboundLogs.slice(0, 8).map((log, index) => (
                  <div key={`${log.LogID || index}`} className="flex justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                    <span>{log.Action || 'Evento'}</span>
                    <span className="font-semibold">{log.LogDate ? new Date(log.LogDate).toLocaleString('es-MX') : 'Sin fecha'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setSelectedOrder(null);
              setSelectedOutboundOrder(null);
              setSelectedOutboundDetails([]);
              setSelectedOutboundLogs([]);
            }}
            className="w-full rounded-2xl border border-slate-100 bg-white py-4 text-sm font-black uppercase tracking-widest text-slate-600"
          >
            Regresar
          </button>
        </div>
      </Layout>
    );
  }

  

  if (!isOutbound && inboundView !== 'detail' && lotMode) {
    return (
      <Layout title="Entradas">
        <div className="space-y-6">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Recepción por lote</p>
            <h2 className="mt-3 text-2xl font-black text-slate-900 dark:text-slate-100">Escanea o captura el lote para recibir</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">El lote se abrirá directamente en la pantalla de recepción.</p>
            <div className="mt-5 space-y-3">
              <input
                value={lotInput}
                onChange={(e) => setLotInput(e.target.value)}
                placeholder="Escanea o escribe el lote"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-700/80 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleLotLookup}
                disabled={lotLookupLoading || !lotInput.trim()}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {lotLookupLoading ? 'Abriendo recepción...' : 'Recibir lote'}
              </button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Órdenes de entrada</p>
                <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">Filtra por aprobadas o pendientes</p>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/80">
                <button
                  type="button"
                  onClick={() => setInboundTab('approved')}
                  className={`rounded-2xl px-4 py-2 text-sm font-black uppercase tracking-widest transition ${inboundTab === 'approved' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  Aprobadas
                </button>
                <button
                  type="button"
                  onClick={() => setInboundTab('pending')}
                  className={`rounded-2xl px-4 py-2 text-sm font-black uppercase tracking-widest transition ${inboundTab === 'pending' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  Pendientes
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                <span>{inboundTab === 'approved' ? 'Historial de transferencias' : 'Órdenes pendientes'}</span>
            </div>

            <div className="mt-4 space-y-3">
              {loadingOrders ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  Cargando órdenes...
                </div>
              ) : (
                (inboundTab === 'approved' ? inboundApprovedOrders : inboundPendingOrders).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                    No hay órdenes {inboundTab === 'approved' ? 'aprobadas' : 'pendientes'} para mostrar.
                  </div>
                ) : (
                  <>
                    {(inboundTab === 'approved' ? inboundApprovedOrders : inboundPendingOrders).map((order) => (
                      <button
                        key={order.PurchaseOrderID}
                        type="button"
                        onClick={() => void handleSelectInboundOrder(order as InboundOrderSummary)}
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-left transition-all hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-700/40 dark:hover:border-slate-500"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">{order.PONumber || order.PurchaseOrderID}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{order.ProviderName || `Proveedor ${order.ProviderID}`}</p>
                            {order.LotReceiveID ? (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Lote: {order.LotReceiveID}{order.LotInventoryID ? ` • Inventario ${order.LotInventoryID}` : ''}</p>
                            ) : null}
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Solo se pueden ver los detalles desde aquí, la recepción real se hace desde el escaneo del lote.</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {inboundTab === 'approved' ? 'Aprobada' : 'Pendiente'}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          <span>Recibido: {order.receivedQty ?? 0}</span>
                          <span>Esperado: {order.orderedQty ?? 0}</span>
                        </div>
                      </button>
                    ))}

                    {inboundHasMore && (
                      <div className="mt-3 flex justify-center">
                        <button
                          type="button"
                          onClick={() => void loadInboundOrders(false)}
                          className="px-6 py-2 rounded-xl bg-slate-900 text-white font-black"
                        >
                          Cargar más
                        </button>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (isInboundDetailView) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950/75 p-3 sm:p-6">
        <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Detalle de recepción</p>
              <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{selectedInboundOrder?.PONumber || 'Recepción'}</p>
            </div>
            <button
              type="button"
              onClick={closeInboundDetailView}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black uppercase tracking-widest text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              Cerrar
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-700/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Proveedor y Orden</p>
              <p className="mt-2 text-lg font-black text-slate-900 dark:text-slate-100">{selectedInboundOrder?.ProviderName || 'Proveedor'}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">PO: {selectedInboundOrder?.PONumber || 'Sin PO'}</p>
              {selectedInboundOrder?.LotReceiveID ? (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Lote: {selectedInboundOrder.LotReceiveID}{selectedInboundOrder.LotInventoryID ? ` • Inventario ${selectedInboundOrder.LotInventoryID}` : ''}</p>
              ) : null}
            </div>

            {inboundSummary && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Esperado</p>
                  <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{inboundSummary.totalExpected}</p>
                </div>
                <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Escaneado</p>
                  <p className="mt-2 text-2xl font-black text-blue-600 dark:text-blue-400">{totalScannedPieces}</p>
                </div>
                <div className="rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Restante</p>
                  <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{totalRemainingToScanPieces}</p>
                </div>
              </div>
            )}

            <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Artículos a recibir</p>
              {selectedInboundDetails.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Aún no hay líneas para esta orden.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {selectedInboundDetails.map((item) => {
                    const scanned = scannedCounts[item.PurchaseOrderDetailID] || 0;
                    const expected = Number(item.Qty || 0);
                    const received = Number(item.ReceivedQty || 0);
                    const remaining = Math.max(0, expected - received - scanned);
                    const isComplete = remaining === 0 && scanned > 0;

                    return (
                      <div
                        key={item.PurchaseOrderDetailID}
                        className={`rounded-2xl border p-4 transition-all ${
                          isComplete
                            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20'
                            : 'border-slate-100 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-700/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">
                              {item.PartNumber || item.ItemID}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{item.PartName || 'Sin descripción'}</p>
                            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                              Área: {item.WorkArea || 'Sin área'} | Medida: {item.MeasureDescription || 'Unidad'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Escaneado</p>
                            <p className="mt-1 text-2xl font-black text-blue-600 dark:text-blue-400">{scanned}</p>
                            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Restante: {remaining}</p>
                          </div>
                        </div>

                        {!isReadonlyInboundOrder && remaining > 0 && (
                          <button
                            type="button"
                            onClick={() => handleScanPiece(item)}
                            className="mt-3 w-full rounded-xl border-2 border-blue-500 bg-blue-50 py-2 text-sm font-black uppercase tracking-widest text-blue-600 transition-all active:scale-95 dark:bg-blue-900/20 dark:text-blue-400"
                          >
                            <Scan size={16} className="mb-1 inline mr-2" />
                            Escanear (+1)
                          </button>
                        )}

                        {isComplete && (
                          <div className="mt-3 flex items-center gap-2 rounded-xl border-2 border-emerald-500 bg-emerald-50 py-2 px-3 dark:border-emerald-900/50 dark:bg-emerald-900/20">
                            <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">Completo</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {!isReadonlyInboundOrder && totalScannedPieces > 0 && (
              <button
                type="button"
                onClick={handleOpenQuarantineModal}
                disabled={confirming}
                className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-sm font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800"
              >
                {confirming ? 'Procesando...' : `Confirmar recepción (${totalScannedPieces} piezas)`}
              </button>
            )}
            {isReadonlyInboundOrder && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                Esta orden está en estado {selectedInboundStatusId} y solo puedes revisar sus detalles. La interacción real se hace desde el escaneo del lote.
              </div>
            )}

            {showQuarantineModal && (
              <div className="fixed inset-0 z-[110] bg-slate-950/80 p-3 sm:p-6">
                <div className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Confirmar recepción</p>
                      <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">Selecciona la ubicación de rack de destino</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowQuarantineModal(false)}
                      className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-4 p-4 sm:p-6">
                    {selectedLot ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                        <div className="font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300">Lote actual</div>
                        <div className="mt-2 text-slate-900 dark:text-slate-100">
                          {selectedLot.InternalLot || selectedLot.ProviderLot || selectedLot.ShortInternalLot || `#${selectedLot.LotReceiveID || selectedLot.ReceiveID || 'n/a'}`}
                        </div>
                        <div className="mt-1 text-slate-600 dark:text-slate-400">
                          Ubicación actual: {selectedLot.CurrentLocationID ? String(selectedLot.CurrentLocationID) : 'Sin ubicación registrada'}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Rack de destino</span>
                        <input
                          type="text"
                          value={rackCodeInput}
                          onChange={(e) => handleRackCodeChange(e.target.value)}
                          placeholder="Ej.: A-01-02"
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </label>

                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-sm font-black text-slate-900 dark:text-slate-100">Catálogo de ubicaciones disponibles</p>
                        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{storageLocations.length} ubicaciones</span>
                      </div>
                      {loadingStorageLocations ? (
                        <div className="py-8 text-center text-slate-500">Cargando ubicaciones...</div>
                      ) : storageLocations.length === 0 ? (
                        <div className="py-8 text-center text-slate-500">No hay ubicaciones de rack disponibles.</div>
                      ) : (
                        <div className="grid gap-2 max-h-80 overflow-y-auto pt-3">
                          {storageLocations.map((loc) => {
                            const locationCode = getStorageLocationCode(loc);
                            const isSelected = selectedStorageLocation?.StorageID === loc.StorageID;
                            return (
                              <button
                                key={loc.StorageID}
                                type="button"
                                onClick={() => {
                                  setSelectedStorageLocation(loc);
                                  setDestinationLocationId(String(loc.StorageID ?? loc.LocationID ?? ''));
                                  setRackCodeInput(locationCode);
                                }}
                                className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? 'border-blue-600 bg-blue-50 text-slate-900 dark:border-blue-400 dark:bg-blue-900/30 dark:text-white' : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100'}`}
                              >
                                <div className="font-bold">{locationCode}</div>
                                <div className="mt-1 text-sm opacity-80">
                                  {loc.LocationName ? `${loc.LocationName} • ` : ''}Col {loc.RackColumn} - Cel {loc.RackCell}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={handleConfirmOrder}
                        disabled={confirming || !selectedStorageLocation}
                        className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-sm font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 sm:w-auto"
                      >
                        {confirming ? 'Procesando...' : 'Confirmar recepción'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowQuarantineModal(false)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-black uppercase tracking-widest text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 sm:w-auto"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Layout title={title}>
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          {!isOutbound ? (
            <>
              <input
                type="text"
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                placeholder="Proveedor"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              <input
                type="text"
                value={poFilter}
                onChange={(e) => setPoFilter(e.target.value)}
                placeholder="Orden / PO"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              >
                <option value="">Todos</option>
                {statusOptions.map((s) => (
                  <option key={s.StatusID} value={String(s.StatusID)}>{s.StatusDescription || s.StatusCode}</option>
                ))}
              </select>
            </>
          ) : (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none md:col-span-4"
            >
              <option value="">Todos los estados</option>
              {outboundStatusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          )}
        </div>

        {loadingOrders ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando órdenes...
          </div>
        ) : (
          orders.map((order, index) => {
            const isInboundOrder = !isOutbound;
            const statusLabel = isInboundOrder
              ? (order.StatusDescription || order.StatusType || 'Pendiente')
              : (order.StatusDescription || order.StatusCode || 'Pendiente');
            const badgeClass = isInboundOrder
              ? 'bg-emerald-500/10 text-emerald-600'
              : 'bg-blue-500/10 text-blue-600';
            const titleLabel = isInboundOrder ? (order.PONumber || order.PurchaseOrderID) : (order.ShipmentNumber || order.ShipmentID);
            const subtitle = isInboundOrder
              ? (order.ProviderName || `Proveedor ${order.ProviderID}`)
              : (order.CustomerID || 'Cliente');
            const itemCount = isInboundOrder ? (order.itemCount ?? 0) : (order.itemCount ?? 0);
            const dateText = isInboundOrder
              ? (order.OrderDate ? new Date(order.OrderDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : 'Sin fecha')
              : (order.ShipmentDate ? new Date(order.ShipmentDate).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : 'Sin fecha');

            return (
              <motion.button
                key={isInboundOrder ? order.PurchaseOrderID : order.ShipmentID}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => {
                  if (isInboundOrder) {
                    void handleSelectInboundOrder(order as InboundOrderSummary);
                  } else {
                    void handleSelectOutboundOrder(order);
                  }
                }}
                className="w-full bg-white dark:bg-slate-800/95 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm text-left flex items-center gap-4 active:scale-[0.98] transition-all group"
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isInboundOrder ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300'}`}>
                  {isInboundOrder ? <ArrowDownCircle size={28} /> : <ArrowUpCircle size={28} />}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">{titleLabel}</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md ${badgeClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900 dark:text-slate-100 mb-1">{subtitle}</h3>
                  <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase">
                    <span className="flex items-center gap-1"><Package size={12} /> {itemCount} Items</span>
                    <span className="flex items-center gap-1"><Calendar size={12} /> {dateText}</span>
                  </div>
                  {isInboundOrder && (
                    <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-300">
                      <span>Recibido: {order.receivedQty ?? 0}</span>
                      <span>/</span>
                      <span>Esperado: {order.orderedQty ?? 0}</span>
                    </div>
                  )}
                </div>
                <ChevronRight size={20} className="text-slate-300 dark:text-slate-400 group-hover:text-blue-500 transition-colors" />
              </motion.button>
            );
          })
        )}
        {isOutbound && outboundHasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => { void loadOutboundOrders(false); }}
              className="rounded-full bg-blue-600 text-white px-6 py-2 font-bold shadow-md"
            >
              Cargar más
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
};