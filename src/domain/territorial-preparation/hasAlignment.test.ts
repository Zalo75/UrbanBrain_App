import { describe, it, expect } from 'vitest'
import {
  deriveAffineFromTRS,
  transformPointTRS,
  transformPointAffine,
  type Point2D,
  type DerivedAffine
} from './hasAlignment'

const EPSILON = 1e-10

function almostEqualPoint(p1: Point2D, p2: Point2D) {
  expect(Math.abs(p1.x - p2.x)).toBeLessThan(EPSILON)
  expect(Math.abs(p1.y - p2.y)).toBeLessThan(EPSILON)
}

function dotProduct(v1: Point2D, v2: Point2D): number {
  return v1.x * v2.x + v1.y * v2.y
}

describe('HAS V1 T·R·S Math', () => {
  const defaultSourcePivot = { x: 100, y: 100 }
  const defaultTargetPivot = { x: 500, y: 500 }
  const testPoint = { x: 150, y: 150 }

  it('1. Identidad: θ=0, sx=1, sy=1 y pivotes equivalentes', () => {
    // Si los pivotes son los mismos, el punto no debe moverse
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultSourcePivot, 0, 1, 1)
    almostEqualPoint(p1, testPoint)
  })

  it('2. Traslación pura', () => {
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 1, 1)
    // El punto se mueve (500 - 100) = 400 en ambas direcciones
    almostEqualPoint(p1, { x: 550, y: 550 })
  })

  it('3. Rotación pura', () => {
    // Rotar 90 grados alrededor de (100, 100) y trasladar a (500, 500)
    // p - c = (50, 50)
    // R(90) * (50, 50) = (-50, 50)
    // t + (-50, 50) = (500 - 50, 500 + 50) = (450, 550)
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 90, 1, 1)
    almostEqualPoint(p1, { x: 450, y: 550 })
  })

  it('4. Escala uniforme', () => {
    // Escala 2x
    // p - c = (50, 50) -> (100, 100)
    // t + (100, 100) = (600, 600)
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 2, 2)
    almostEqualPoint(p1, { x: 600, y: 600 })
  })

  it('5. Escala anisotrópica: sx != sy', () => {
    // sx=2, sy=3
    // p - c = (50, 50) -> (100, 150)
    // t + ... = (600, 650)
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 2, 3)
    almostEqualPoint(p1, { x: 600, y: 650 })
  })

  it('6. Rotación + escala anisotrópica', () => {
    // sx=2, sy=3, rot=90
    // S -> (100, 150)
    // R -> (-150, 100)
    // T -> (500 - 150, 500 + 100) = (350, 600)
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 90, 2, 3)
    almostEqualPoint(p1, { x: 350, y: 600 })
  })

  it('7. Caso explícito θ=30° con sx != sy', () => {
    const rot = 30
    const sx = 1.5
    const sy = 0.5
    
    // Manual math
    const rad = rot * Math.PI / 180
    const dx = 50 * sx // 75
    const dy = 50 * sy // 25
    
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad) // 75 * √3/2 - 25 * 0.5
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad) // 75 * 0.5 + 25 * √3/2

    const expected = {
      x: 500 + rx,
      y: 500 + ry
    }

    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, rot, sx, sy)
    almostEqualPoint(p1, expected)
  })

  it('8. Caso explícito θ=90° con sx != sy', () => {
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 90, 2, 0.5)
    // S -> (100, 25)
    // R(90) -> (-25, 100)
    // T -> (475, 600)
    almostEqualPoint(p1, { x: 475, y: 600 })
  })

  it('9. Scale X/Y sigue actuando sobre los EJES LOCALES originales tras rotación', () => {
    // Consideremos el punto (101, 100) -> un paso en +X original
    // Tras escalado local (sx=10, sy=1) -> (110, 100) -> vector local (10, 0)
    // Si aplicamos rotación de 90, ese vector de escalado X puro debe apuntar en -Y mundo.
    // T = (0,0), C = (100,100).
    const p1 = transformPointTRS({ x: 101, y: 100 }, defaultSourcePivot, { x: 0, y: 0 }, 90, 10, 1)
    
    // (101,100) - (100,100) = (1,0)
    // S -> (10,0)
    // R(90) -> (0,10)
    // T -> (0,10)
    almostEqualPoint(p1, { x: 0, y: 10 })
  })

  it('10. Ausencia de shear no intencionado', () => {
    // Si transformamos [1,0] y [0,1] desde el pivote original
    const pX = { x: defaultSourcePivot.x + 1, y: defaultSourcePivot.y }
    const pY = { x: defaultSourcePivot.x, y: defaultSourcePivot.y + 1 }

    const tCenter = transformPointTRS(defaultSourcePivot, defaultSourcePivot, defaultTargetPivot, 33.3, 4.5, 0.8)
    const tX = transformPointTRS(pX, defaultSourcePivot, defaultTargetPivot, 33.3, 4.5, 0.8)
    const tY = transformPointTRS(pY, defaultSourcePivot, defaultTargetPivot, 33.3, 4.5, 0.8)

    // Vectores resultantes
    const vX = { x: tX.x - tCenter.x, y: tX.y - tCenter.y }
    const vY = { x: tY.x - tCenter.x, y: tY.y - tCenter.y }

    // El producto escalar debe ser muy cercano a 0 (ortogonales)
    const dp = dotProduct(vX, vY)
    expect(Math.abs(dp)).toBeLessThan(EPSILON)
  })

  it('11. Equivalencia entre T·R·S y matriz afín derivada', () => {
    const affine = deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 45, 1.2, 0.7)
    const pDirect = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 45, 1.2, 0.7)
    const pAffine = transformPointAffine(testPoint, affine)

    almostEqualPoint(pDirect, pAffine)
  })

  it('12. Independencia del viewport', () => {
    // Cambiar las dimensiones del canvas NO altera el cálculo matemático, 
    // porque T, R y S están definidos en términos del espacio del raster original y el mundo (CRS).
    // Si simulamos dos visores distintos, pero con los mismos parámetros de mundo:
    const pDirect = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 15, 2, 2)

    // Un visor hipotético solo altera dónde se dibuja en SU pantalla, no las coordenadas transformadas.
    // Simplemente verificamos que el resultado depende 100% de los parámetros pasados y no hay estado.
    const pDirect2 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 15, 2, 2)
    almostEqualPoint(pDirect, pDirect2)
  })

  it('13. Determinismo', () => {
    const p1 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 23.5, 1.11, 0.99)
    const p2 = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 23.5, 1.11, 0.99)
    expect(p1).toEqual(p2)
  })

  it('14. Reconstrucción', () => {
    // Si guardamos los parámetros:
    const savedParameters = {
      sourcePivot: defaultSourcePivot,
      targetPivot: defaultTargetPivot,
      rotation: 12.3,
      scaleX: 2.5,
      scaleY: 1.5
    }

    const reconstructed = transformPointTRS(
      testPoint,
      savedParameters.sourcePivot,
      savedParameters.targetPivot,
      savedParameters.rotation,
      savedParameters.scaleX,
      savedParameters.scaleY
    )

    // Equivalente a usar los parámetros directamente
    const expected = transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 12.3, 2.5, 1.5)
    almostEqualPoint(reconstructed, expected)
  })

  it('15. Rechazo de scaleX/Y = 0', () => {
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 0, 1)).toThrow()
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 1, 0)).toThrow()
    expect(() => deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 0, 0, 1)).toThrow()
    expect(() => deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 0, 1, 0)).toThrow()
  })

  it('16. Rechazo de scaleX/Y < 0', () => {
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, -1, 1)).toThrow()
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 1, -2)).toThrow()
    expect(() => deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 0, -0.5, 1)).toThrow()
    expect(() => deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 0, 1, -0.1)).toThrow()
  })

  it('17. Rechazo de NaN e Infinity en escalas', () => {
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, NaN, 1)).toThrow()
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, 0, 1, Infinity)).toThrow()
    expect(() => deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 0, -Infinity, 1)).toThrow()
  })

  it('18. Rechazo de NaN e Infinity en rotación', () => {
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, NaN, 1, 1)).toThrow()
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, Infinity, 1, 1)).toThrow()
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, defaultTargetPivot, -Infinity, 1, 1)).toThrow()
  })

  it('19. Rechazo de NaN e Infinity en pivotes y puntos', () => {
    const invalidP = { x: NaN, y: 100 }
    const invalidSp = { x: 100, y: Infinity }
    const invalidTp = { x: -Infinity, y: 500 }
    
    // Punto p inválido
    expect(() => transformPointTRS(invalidP, defaultSourcePivot, defaultTargetPivot, 0, 1, 1)).toThrow()
    
    // sourcePivot inválido
    expect(() => transformPointTRS(testPoint, invalidSp, defaultTargetPivot, 0, 1, 1)).toThrow()
    expect(() => deriveAffineFromTRS(invalidSp, defaultTargetPivot, 0, 1, 1)).toThrow()
    
    // targetPivot inválido
    expect(() => transformPointTRS(testPoint, defaultSourcePivot, invalidTp, 0, 1, 1)).toThrow()
    expect(() => deriveAffineFromTRS(defaultSourcePivot, invalidTp, 0, 1, 1)).toThrow()
    
    // En transformPointAffine
    const validAffine = deriveAffineFromTRS(defaultSourcePivot, defaultTargetPivot, 0, 1, 1)
    expect(() => transformPointAffine(invalidP, validAffine)).toThrow()
  })
})
