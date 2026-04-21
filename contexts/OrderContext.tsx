import React, { createContext, useState, useCallback, ReactNode } from 'react';
import { fetchOrders, fetchTransactions, Order, Transaction } from '@/services/orderService';

interface OrderContextType {
  orders: Order[];
  transactions: Transaction[];
  loading: boolean;
  refreshOrders: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
}

export const OrderContext = createContext<OrderContextType | undefined>(undefined);

export function OrderProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchOrders();
      setOrders(data);
    } catch (e) {
      console.error('Failed to fetch orders:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTransactions = useCallback(async () => {
    try {
      const data = await fetchTransactions();
      setTransactions(data);
    } catch (e) {
      console.error('Failed to fetch transactions:', e);
    }
  }, []);

  return (
    <OrderContext.Provider value={{ orders, transactions, loading, refreshOrders, refreshTransactions }}>
      {children}
    </OrderContext.Provider>
  );
}
