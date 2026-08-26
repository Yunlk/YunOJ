export function ratingClass(rating: number): string {
  if (rating >= 2600) return 'rating-limit'
  if (rating >= 2400) return 'rating-purple'
  if (rating >= 2200) return 'rating-red'
  if (rating >= 2000) return 'rating-orange'
  if (rating >= 1800) return 'rating-gold'
  if (rating >= 1600) return 'rating-teal'
  if (rating >= 1400) return 'rating-green'
  if (rating >= 1200) return 'rating-blue'
  return 'rating-gray'
}
