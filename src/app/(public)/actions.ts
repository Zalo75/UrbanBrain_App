"use server"

export async function submitContactForm(data: FormData) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 1000));
  
  const name = data.get('name');
  const email = data.get('email');
  const message = data.get('message');

  if (!name || !email || !message) {
    return { success: false, error: "Faltan campos obligatorios." };
  }

  // TODO: Integrar con Resend, SendGrid o similar para enviar a technika360@technika360.com
  console.log("Formulario de contacto recibido:", {
    name,
    email,
    company: data.get('company'),
    phone: data.get('phone'),
    message,
  });

  return { success: true };
}
