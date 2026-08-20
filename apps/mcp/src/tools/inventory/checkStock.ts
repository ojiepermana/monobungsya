import { z } from 'zod';
import { getStock } from '../../services/erpApi';
import { jsonToolResponse } from '../../utils/toolResponse';
import { defineTool } from '../types';

export const checkStockTool = defineTool({
  name: 'check_stock',
  description: 'Check inventory stock by SKU from ERP',
  inputSchema: z.object({ sku: z.string().min(1) }),
  execute: async ({ sku }) => jsonToolResponse(await getStock(sku)),
});
