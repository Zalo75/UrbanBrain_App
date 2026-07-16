export interface InitialContextAcceptance {
  noticeAccepted: boolean
  technicallyReviewed: false
}

/**
 * Accepting the initial legal/accuracy notice never constitutes a technical review.
 * The legacy field is deliberately ignored even if a crafted form still submits it.
 */
export function getInitialContextAcceptance(formData: FormData): InitialContextAcceptance {
  return {
    noticeAccepted: formData.get('initialContextNoticeAccepted') === 'true',
    technicallyReviewed: false,
  }
}
