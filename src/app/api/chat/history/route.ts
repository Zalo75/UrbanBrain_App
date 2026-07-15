import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/infrastructure/db/client';
import { chatMessages } from '@/infrastructure/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const expedienteId = searchParams.get('expedienteId');

    if (!expedienteId) {
      return NextResponse.json({ error: 'expedienteId is required' }, { status: 400 });
    }

    const access = await getExpedienteAccess(expedienteId);
    if (!access.ok) {
      const status = access.reason === 'unauthenticated' ? 401 : 404;
      return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Not found' }, { status });
    }

    // Obtener historial ordenado cronológicamente
    const history = await db
      .select({
        role: chatMessages.role,
        content: chatMessages.content,
        sources: chatMessages.sources,
      })
      .from(chatMessages)
      .where(eq(chatMessages.expedienteId, expedienteId))
      .orderBy(asc(chatMessages.createdAt));

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Error fetching chat history:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
