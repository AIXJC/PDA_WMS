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
  const [quarantineQty, setQuarantineQty] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [sourceLocations, setSourceLocations] = useState<Array<{LocationID:number; LocationName:string}>>([]);
  const [destinationLocations, setDestinationLocations] = useState<Array<{LocationID:number; LocationName:string}>>([]);
  const [providerFilter, setProviderFilter] = useState('');
  const [poFilter, setPoFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
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

  const isOutbound = type === 'outbound';
  const title = isOutbound ? 'Órdenes de Salida' : 'Órdenes de Entrada';
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
  }, [isOutbound, isInboundDetailRoute, detailId, requestedPo, location.search]);

  useEffect(() => {
    if (isOutbound || !selectedInboundOrder) return;

    const loadDestinationLocations = async () => {
      try {
        const response = await fetch('/api/scrap/location-options');
        if (!response.ok) return;
        const data = await response.json();
        const nextSourceLocations = Array.isArray(data.sourceLocations) ? data.sourceLocations : [];
        const nextDestinationLocations = Array.isArray(data.destinationLocations) ? data.destinationLocations : [];
        setSourceLocations(nextSourceLocations);
        setDestinationLocations(nextDestinationLocations);
        if (!sourceLocationId && nextSourceLocations[0]) {
          setSourceLocationId(String(nextSourceLocations[0].LocationID));
        }
      } catch (error) {
        console.error('No se pudieron cargar las ubicaciones destino', error);
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
      const loadOutboundOrders = async () => {
        try {
          setLoadingOrders(true);
          const params = new URLSearchParams();
          params.set('limit', '100');
          if (statusFilter) params.set('status', statusFilter);
          const response = await fetch(`/api/orders/outbound?${params.toString()}`);
          if (!response.ok) throw new Error('No fue posible cargar las salidas');
          const data = await response.json();
          const nextOrders = Array.isArray(data.orders) ? data.orders : [];
          setOrders(nextOrders);
          setOutboundStatusOptions(Array.from(new Set(nextOrders.map((order: any) => String(order.StatusDescription || order.StatusCode || 'Sin estado').trim()).filter(Boolean))));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Error cargando salidas');
          setOrders([]);
          setOutboundStatusOptions([]);
        } finally {
          setLoadingOrders(false);
        }
      };

      void loadOutboundOrders();
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

    const loadInboundOrders = async () => {
      try {
        setLoadingOrders(true);
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (providerFilter) params.set('provider', providerFilter);
        if (poFilter) params.set('poNumber', poFilter);
        if (dateFilter) params.set('date', dateFilter);
        if (statusFilter) params.set('status', statusFilter);

        const response = await fetch(`/api/orders/inbound?${params.toString()}`);
        if (!response.ok) throw new Error('No fue posible cargar las entradas');
        const data = await response.json();
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error cargando entradas');
      } finally {
        setLoadingOrders(false);
      }
    };

    loadInboundOrders();
  }, [isOutbound, providerFilter, poFilter, dateFilter, statusFilter]);

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
    setSelectedOrder(String(purchaseOrderId));
    setInboundView('detail');
    setSelectedInboundOrder(orderSummary ? ({ ...orderSummary, PurchaseOrderID: purchaseOrderId } as InboundOrderSummary) : null);
    setSelectedInboundDetails([]);
    setSelectedInboundReceipts([]);
    if (resetLot) {
      setSelectedLot(null);
      setLotInput('');
    }
    setLotMode(false);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/orders/inbound/${purchaseOrderId}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle de la entrada');
      const data = await response.json();
      setSelectedInboundOrder({ ...(orderSummary || {}), PurchaseOrderID: purchaseOrderId, ...(data.order || {}) } as InboundOrderSummary);
      setSelectedInboundDetails(Array.isArray(data.details) ? data.details : []);
      setSelectedInboundReceipts(Array.isArray(data.receipts) ? data.receipts : []);
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

  const handleSelectLot = async (lot: any) => {
    setSelectedLot(lot);
    setSelectedLotDetails(lot);
    setError('');
    setLotInput(String(lot?.ProviderLot || lot?.InternalLot || lot?.ShortInternalLot || lot?.ReceiveID || lot?.LotReceiveID || ''));

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

    setQuarantineQty(0);
    // default selected status based on current progress
    const totalExpected = inboundSummary?.totalExpected ?? 0;
    const totalReceived = inboundSummary?.totalReceived ?? 0;
    const scanned = totalScannedPieces;
    const projected = totalReceived + scanned;
    let defaultId = '';
    if (projected <= 0) defaultId = String(20);
    else if (projected < totalExpected) defaultId = String(8);
    else defaultId = String(10);
    setSelectedStatusId(defaultId);
    setShowQuarantineModal(true);
    setError('');
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
    if (quarantineQty < 0 || quarantineQty > totalScanned) {
      setError('La cantidad para cuarentena no puede ser mayor al total escaneado.');
      return;
    }

    setError('');
    setConfirming(true);
    try {
      const response = await fetch(`/api/orders/inbound/${selectedInboundOrder.PurchaseOrderID}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scannedDetails,
          quarantineQty,
          receivedBy: user?.id ? Number(user.id) : undefined,
          orderStatusId: selectedStatusId ? Number(selectedStatusId) : undefined,
          destinationLocationId: destinationLocationId ? Number(destinationLocationId) : undefined,
          sourceLocationId: sourceLocationId ? Number(sourceLocationId) : undefined,
          requestUserId: user?.id ? Number(user.id) : undefined,
          lotReference: selectedLot?.InternalLot || selectedLot?.ShortInternalLot || selectedLot?.ProviderLot || selectedLot?.LotReceiveID || selectedLot?.ReceiveID || null,
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
      <Layout title="Historial y escaneo">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Lotes disponibles</p>
                <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">Toca uno para abrir su orden de recepción</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {filteredAvailableLots.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {availableLotsLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  Cargando lotes...
                </div>
              ) : filteredAvailableLots.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  No hay lotes disponibles para mostrar.
                </div>
              ) : filteredAvailableLots.map((lot: any) => {
                const lotName = lot.InternalLot || lot.ShortInternalLot || lot.ProviderLot || `Lote ${lot.ReceiveID || lot.LotReceiveID}`;
                return (
                  <button
                    key={`${lot.ReceiveID || lot.LotReceiveID || lot.ProviderLot || lot.InternalLot}-${lot.PurchaseOrderID || lot.PONumber || 'lot'}`}
                    type="button"
                    onClick={() => void handleSelectLot(lot)}
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-left transition-all hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-700/40 dark:hover:border-slate-500"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">{lot.PONumber || 'Sin PO'}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{lotName}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      <span>Cantidad: {lot.Quantity ?? 0}</span>
                      <span>Proveedor: {lot.ProviderLot || 'Sin referencia'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Órdenes pendientes por recibir</p>
                <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">Toca una para abrir sus detalles</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {orders.filter((order) => getInboundOrderStatus(order) === 'pending').length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {loadingOrders ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  Cargando órdenes...
                </div>
              ) : orders.filter((order) => getInboundOrderStatus(order) === 'pending').length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  No hay órdenes pendientes para mostrar.
                </div>
              ) : orders.filter((order) => getInboundOrderStatus(order) === 'pending').map((order) => (
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
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      Pendiente
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    <span>Recibido: {order.receivedQty ?? 0}</span>
                    <span>Esperado: {order.orderedQty ?? 0}</span>
                  </div>
                </button>
              ))}
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

                        {remaining > 0 && (
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

            {totalScannedPieces > 0 && (
              <button
                type="button"
                onClick={handleOpenQuarantineModal}
                disabled={confirming}
                className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-sm font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800"
              >
                {confirming ? 'Procesando...' : `Confirmar recepción (${totalScannedPieces} piezas)`}
              </button>
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
      </div>
    </Layout>
  );
};