export class ErrorHttp extends Error {
    constructor(codigoHttp, mensaje, detalle = null) {
        super(mensaje);
        this.name = 'ErrorHttp';
        this.codigoHttp = codigoHttp;
        this.detalle = detalle;
    }
}